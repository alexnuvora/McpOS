(() => {
    const snapshotId = crypto.randomUUID();
    const targets = new Map();
    const interactive = [];
    window.__mcposSnapshot = { snapshotId, targets };
    let visited = 0;
    const seen = new Set();
    function label(element) {
        const ids = (element.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
        const referenced = ids.map(id => element.ownerDocument?.getElementById(id)?.textContent || '').join(' ').trim();
        return (element.getAttribute('aria-label') || referenced || element.getAttribute('data-placeholder') || element.getAttribute('aria-placeholder') || element.getAttribute('placeholder') || element.innerText || element.getAttribute('name') || '').trim().slice(0,140);
    }
    function details(element) {
        const rect = element.getBoundingClientRect?.();
        return {
            bounds: rect && {x:rect.x, y:rect.y, width:rect.width, height:rect.height, coordinateSpace:"frame viewport"},
            richText: Boolean(element.isContentEditable || element.ownerDocument?.designMode === "on"),
            multiline: element.getAttribute("aria-multiline") === "true" || element.localName === "textarea",
        };
    }
    const selector = 'iframe,a[href],button,input,textarea,select,[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="checkbox"],[role="radio"],[role="combobox"],[role="textbox"],[contenteditable]:not([contenteditable="false"])';
    function visible(el) {
        if (!el.getClientRects().length || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
        return !style || (style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none');
    }
    function scan(doc, depth) {
        if (++visited > 24) return;
        const all = Array.from(doc.querySelectorAll(selector));
        if (doc.designMode === "on" && doc.body) all.unshift(doc.body);
        const dialogs = Array.from(doc.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open],[aria-modal="true"]')).filter(el => el.querySelectorAll && visible(el));
        // Prefer the innermost visible dialog containing a real editor, not a nested close-button dialog.
        const editorSelector = 'textarea,input:not([type="hidden"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"]';
        const active = dialogs.slice().reverse().find(dialog => Array.from(dialog.querySelectorAll(editorSelector)).some(visible)) || dialogs.at(-1);
        const candidates = active ? Array.from(active.querySelectorAll(selector)) : all;
        const ordered = candidates.map((el, index) => ({el,index,priority: el.matches('input:not([type="hidden"]),textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]') ? 0 : (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim() ? 1 : 2}));
        ordered.sort((a,b) => a.priority-b.priority || a.index-b.index);
        // Prefer actionable controls in the topmost modal; never fill the budget with background controls.
        for (const {el:element} of ordered) {
            if (interactive.length >= 120) break;
            if (seen.has(element) || !visible(element)) continue;
            seen.add(element);
            if (element.localName === 'iframe') {
                try { if (depth < 4 && visited < 24 && element.contentDocument) scan(element.contentDocument, depth + 1); } catch {}
                continue;
            }
            const elementId = 'mcpos:' + snapshotId + ':' + interactive.length;
            targets.set(elementId, element);
            interactive.push({
                elementId, selector: elementId, ...details(element),
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute('role') || undefined,
                label: label(element),
                type: element.getAttribute('type') || undefined,
                disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
                editable: Boolean(element.isContentEditable || element.ownerDocument?.designMode === 'on') || element.matches('input:not([type="hidden"]),textarea,[contenteditable]:not([contenteditable="false"])'),
                sensitive: element.matches('input[type=password],input[autocomplete=current-password],input[autocomplete=new-password]')
            });
        }
    }
    scan(document, 0);
    return { ok: true, snapshotId, url: location.origin + location.pathname, title: document.title, text: (document.body?.innerText || '').slice(0, 12000), interactive };
})()
