(() => {
    const snapshotId = crypto.randomUUID();
    const targets = new Map();
    const interactive = [];
    window.__mcposSnapshot = { snapshotId, targets };
    let visited = 0;
    const seen = new Set();
    const selector = 'iframe,a[href],button,input,textarea,select,[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="checkbox"],[role="radio"],[role="combobox"],[role="textbox"],[contenteditable]:not([contenteditable="false"])';
    function visible(el) {
        if (!el.getClientRects().length || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
        const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
        return !style || (style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none');
    }
    function scan(doc, depth) {
        if (++visited > 24) return;
        const all = Array.from(doc.querySelectorAll(selector));
        const dialogs = Array.from(doc.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open],[aria-modal="true"]')).filter(el => el.querySelectorAll && visible(el));
        const active = dialogs.at(-1);
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
                elementId, selector: elementId,
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute('role') || undefined,
                label: (element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.innerText || element.getAttribute('name') || '').trim().slice(0, 140),
                type: element.getAttribute('type') || undefined,
                disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
                editable: element.matches('input:not([type="hidden"]),textarea,[contenteditable]:not([contenteditable="false"])'),
                sensitive: element.matches('input[type=password],input[autocomplete=current-password],input[autocomplete=new-password]')
            });
        }
    }
    scan(document, 0);
    return { ok: true, snapshotId, url: location.origin + location.pathname, title: document.title, text: (document.body?.innerText || '').slice(0, 12000), interactive };
})()
