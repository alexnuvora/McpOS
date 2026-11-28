use serde_json::{json, Value};
use uiautomation::{UIAutomation, UIElement, UITreeWalker, types::ControlType};
use uiautomation::patterns::{UIInvokePattern, UISelectionItemPattern, UITextPattern, UIValuePattern};
use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION}};

fn executable(pid: u32) -> Option<String> {
    let mut buffer = vec![0u16; 32768];
    let mut len = buffer.len() as u32;
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() { return None; }
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 { return None; }
    }
    let path = String::from_utf16_lossy(&buffer[..len as usize]);
    std::path::Path::new(&path).file_name()?.to_str().map(str::to_ascii_lowercase)
}

fn windows() -> Result<(UITreeWalker, Vec<UIElement>), String> {
    let automation = UIAutomation::new().map_err(|_| "UI Automation unavailable.")?;
    let walker = automation.get_control_view_walker().map_err(|_| "Window enumeration unavailable.")?;
    let root = automation.get_root_element().map_err(|_| "Desktop unavailable.")?;
    let children = walker.get_children(&root).unwrap_or_default();
    Ok((walker, children))
}

fn selected(id: &Value) -> Result<(UITreeWalker, UIElement), String> {
    let (walker, children) = windows()?;
    let element = children.into_iter().find(|e| e.get_runtime_id().is_ok_and(|r| json!(r) == *id))
        .ok_or("Selected window is no longer available.")?;
    Ok((walker, element))
}

pub fn capture(id: &Value) -> Result<xcap::image::RgbaImage, String> {
    let (_, element) = selected(id)?;
    let handle: isize = element.get_native_window_handle().map_err(|_| "No native window handle.")?.into();
    let pid = element.get_process_id().map_err(|_| "Window process unavailable.")?;
    let window = xcap::Window::all().map_err(|_| "Window enumeration failed.")?.into_iter()
        .find(|w| w.id().ok() == Some(handle as u32) && w.pid().ok() == Some(pid))
        .ok_or("Selected window cannot be captured.")?;
    window.capture_image().map_err(|_| "Window capture failed.".to_string())
}

pub fn app_windows(app: &str) -> Vec<Value> {
    let Ok((_, children)) = windows() else { return vec![] };
    children.iter().filter(|e| {
        let name = e.get_process_id().ok().and_then(executable);
        matches!((app, name.as_deref()), ("chrome",Some("chrome.exe")) | ("notepad",Some("notepad.exe")) | ("calculator",Some("calculatorapp.exe" | "calculator.exe" | "calc.exe")))
    }).filter_map(|e| e.get_runtime_id().ok().map(|r|json!(r))).collect()
}

pub fn document_text(payload: &Value) -> Result<Value,String> {
    let (walker,window) = selected(&payload["windowId"])?;
    let mut elements = Vec::new();
    super::describe_controls(&walker,&window,0,&mut Vec::new(),&mut elements);
    let control = elements.into_iter().find(|e|e.get_runtime_id().is_ok_and(|r|json!(r)==payload["controlId"])).ok_or("Control no longer available.")?;
    if control.is_password().unwrap_or(true) { return Err("Sensitive control.".into()); }
    let max = payload["maxCharacters"].as_i64().unwrap_or(4000).clamp(1,12000) as i32;
    let text = if let Ok(pattern) = control.get_pattern::<UITextPattern>() {
        pattern.get_document_range().and_then(|r|r.get_text(max+1)).map_err(|_|"Text range unavailable.")?
    } else {
        control.get_pattern::<UIValuePattern>().and_then(|p|p.get_value()).map_err(|_|"Control exposes no text or value pattern.")?
    };
    Ok(json!({"text":text.chars().take(max as usize).collect::<String>(),"truncated":text.chars().count()>max as usize}))
}

fn chrome_controls(walker:&UITreeWalker, root:&UIElement, depth:u8, budget:&mut usize, tabs:&mut Vec<UIElement>, add:&mut Option<UIElement>) {
    if depth>14 || *budget==0 {return;}
    let mut next=walker.get_first_child(root).ok();
    while let Some(e)=next {
        if *budget==0 {break;}
        *budget-=1;
        next=walker.get_next_sibling(&e).ok();
        match e.get_control_type().ok() {
            Some(ControlType::Document) => continue,
            Some(ControlType::TabItem) => tabs.push(e),
            Some(ControlType::Button) if e.get_name().is_ok_and(|n|n.to_lowercase().starts_with("new tab")) => *add=Some(e),
            _ => chrome_controls(walker,&e,depth+1,budget,tabs,add),
        }
    }
}

pub fn chrome(payload:&Value)->Result<Value,String>{
    let (walker,window)=selected(&payload["windowId"])?;
    if window.get_process_id().ok().and_then(executable).as_deref()!=Some("chrome.exe") {return Err("Select a Google Chrome window.".into());}
    let mut tabs=Vec::new();
    let mut add=None;
    chrome_controls(&walker,&window,0,&mut 600,&mut tabs,&mut add);
    let action=payload["operation"].as_str().unwrap_or("");
    if action=="list" {
        return Ok(json!({"tabs":tabs.iter().filter_map(|e|Some(json!({"tabId":e.get_runtime_id().ok()?,"title":e.get_name().unwrap_or_default(),"selected":e.get_pattern::<UISelectionItemPattern>().and_then(|p|p.is_selected()).ok()}))).collect::<Vec<_>>() }));
    }
    let before:Vec<_>=tabs.iter().filter_map(|e|e.get_runtime_id().ok()).collect();
    if action=="open" {
        add.ok_or("New tab button unavailable.")?.get_pattern::<UIInvokePattern>().and_then(|p|p.invoke()).map_err(|_|"New tab failed.")?;
    } else {
        let tab=tabs.iter().find(|e|e.get_runtime_id().is_ok_and(|r|json!(r)==payload["tabId"])).ok_or("Tab no longer available.")?;
        match action {
            "switch"=>tab.get_pattern::<UISelectionItemPattern>().and_then(|p|p.select()).map_err(|_|"Tab selection failed.")?,
            "close"=>{
                let close=walker.get_children(tab).unwrap_or_default().into_iter().find(|e|e.get_control_type().ok()==Some(ControlType::Button) && e.get_name().is_ok_and(|n|n.to_lowercase().starts_with("close"))).ok_or("Close button unavailable for this tab.")?;
                close.get_pattern::<UIInvokePattern>().and_then(|p|p.invoke()).map_err(|_|"Tab close failed.")?;
            }
            _=>return Err("Unknown tab operation.".into())
        }
    }
    for _ in 0..12 {
        let mut current=Vec::new();
        chrome_controls(&walker,&window,0,&mut 600,&mut current,&mut None);
        let ids:Vec<_>=current.iter().filter_map(|e|e.get_runtime_id().ok()).collect();
        let created:Vec<_>=ids.iter().filter(|id|!before.contains(id)).collect();
        if action=="open" && created.len()==1 {return Ok(json!({"operation":action,"verification":"tab_opened","tabId":created[0]}));}
        if action=="close" && !current.is_empty() && !ids.iter().any(|id|json!(id)==payload["tabId"]) {
            return Ok(json!({"operation":action,"verification":"tab_closed"}));
        }
        if action=="switch" && current.iter().any(|e|e.get_runtime_id().is_ok_and(|id|json!(id)==payload["tabId"]) &&
            e.get_pattern::<UISelectionItemPattern>().and_then(|p|p.is_selected()).unwrap_or(false)) {
            return Ok(json!({"operation":action,"verification":"tab_selected","tabId":payload["tabId"]}));
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    Err("Tab action dispatched once; outcome unconfirmed. List current windows and tabs before retrying.".into())
}
