(() => {
    const snapshotId = crypto.randomUUID();
    const targets = new Map();
    const interactive = [];
    window.__mcposSnapshot = { snapshotId, targets };
    let visited = 0;
    function scan(doc, depth) {
        if (++visited > 24) return;
        for (const element of doc.querySelectorAll('iframe,a[href],button,input,textarea,select,[role="button"],[contenteditable="true"]')) {
            if (interactive.length >= 80) break;
            if (!element.getClientRects().length || element.closest('[hidden],[inert]')) continue;
            if (element.localName === 'iframe') {
                if (depth < 4 && visited < 24 && element.contentDocument) scan(element.contentDocument, depth + 1);
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
                disabled: Boolean(element.disabled),
                editable: element.matches('input:not([type="hidden"]),textarea,[contenteditable="true"]'),
                sensitive: element.matches('input[type=password],input[autocomplete=current-password],input[autocomplete=new-password]')
            });
        }
    }
    scan(document, 0);
    return { ok: true, snapshotId, url: location.origin + location.pathname, title: document.title, text: (document.body?.innerText || '').slice(0, 12000), interactive };
})()
