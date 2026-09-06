(function() {
  // 会話画面が存在しないフレーム（親ウィンドウの殻など）では動作しない
  function isChatFrame() {
    return !!document.querySelector('[data-testid="conversation-view"], [data-testid="user-input-step"], [aria-label="User message"]');
  }

  var STORAGE_KEY_LEVEL = 'ag_toc_level';
  var currentMaxLevel = parseInt(localStorage.getItem(STORAGE_KEY_LEVEL), 10) || 2;
  var clickedId = null;
  var expandedState = {};
  var uiDoc = document;
  var isDocked = false;

  function clearChildren(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function getContentRoot() {
    return uiDoc.querySelector('[data-testid="conversation-view"]') ||
           uiDoc.querySelector('main, [role="main"]') ||
           uiDoc.body;
  }

  function extractItems() {
    var root = getContentRoot();
    var selector = '[data-testid="user-input-step"], [aria-label="User message"], [class*="user-input-step"], h1, h2, h3, h4, h5, h6';

    var rawElements = [];
    try {
      rawElements = Array.from(root.querySelectorAll(selector));
    } catch(e) {
      console.error('root.querySelectorAll エラー:', e);
    }

    if (rawElements.length === 0 && root !== uiDoc.body) {
      rawElements = Array.from(uiDoc.querySelectorAll(selector));
    }

    // 目次パネル自体の要素を除外
    rawElements = rawElements.filter(function(el) {
      return !el.closest('#ag_toc_container');
    });

    var items = [];
    var seenPrompts = new Set();

    rawElements.forEach(function(el) {
      if (el.closest('nav, aside, [role="navigation"], [data-testid="sidebar"]')) {
        return;
      }

      var isPrompt = el.matches('[data-testid="user-input-step"]') ||
                     el.matches('[aria-label="User message"]') ||
                     (el.className && typeof el.className === 'string' && el.className.indexOf('user-input') !== -1);

      if (isPrompt) {
        var pRoot = el.closest('[data-testid="user-input-step"]') ||
                    el.closest('[aria-label="User message"]') ||
                    el.closest('[class*="user-input-step"]') ||
                    el;

        if (seenPrompts.has(pRoot)) return;
        seenPrompts.add(pRoot);

        var textContainer = el.querySelector('.whitespace-pre-wrap') ||
                            el.querySelector('[class*="text-"]') ||
                            el;
        var clone = textContainer.cloneNode(true);
        clone.querySelectorAll('button, svg, [role="button"], [class*="user-input-buttons"], .timestamp').forEach(function(b) {
          b.remove();
        });
        var text = (clone.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text) text = 'ユーザープロンプト';

        items.push({
          isPrompt: true,
          level: 1,
          tag: 'PROMPT',
          text: text,
          el: pRoot
        });
      } else {
        var tagName = el.tagName ? el.tagName.toLowerCase() : '';
        if (!/^h[1-6]$/.test(tagName)) return;

        var hLevel = parseInt(tagName.charAt(1), 10) || 2;
        var text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!text) return;

        items.push({
          isPrompt: false,
          level: hLevel,
          tag: el.tagName,
          text: text,
          el: el
        });
      }
    });

    console.group('%c🌲 [AntiGravity 会話目次] 抽出診断', 'color: #1a73e8; font-size: 13px; font-weight: bold;');
    console.log('📍 会話ルート要素:', root);
    console.log('📋 抽出アイテム数:', items.length + ' 件');
    if (items.length > 0) {
      console.table(items.map(function(it, idx) {
        return {
          '#': idx,
          '種別': it.isPrompt ? '👤 プロンプト' : '📌 AI見出し',
          'タグ': it.tag,
          'Level': it.level,
          'テキスト': it.text.length > 50 ? it.text.substring(0, 50) + '...' : it.text
        };
      }));
    }
    console.groupEnd();

    return items;
  }

  function buildTree(items) {
    var root = { children: [], treeDepth: 0 };
    var currentPromptNode = null;
    var stack = [];

    items.forEach(function(item, index) {
      var node = {
        item: item,
        index: index,
        level: item.level,
        children: []
      };

      if (item.isPrompt) {
        node.treeDepth = 1;
        root.children.push(node);
        currentPromptNode = node;
        stack = [node];
      } else {
        if (!currentPromptNode) {
          node.treeDepth = 1;
          root.children.push(node);
          stack = [node];
        } else {
          while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
            stack.pop();
          }
          node.treeDepth = stack.length + 1;
          stack[stack.length - 1].children.push(node);
          stack.push(node);
        }
      }
    });

    return root;
  }

  var cssContent = [
    '[data-testid="conversation-view"] [data-testid="user-input-step"], [data-testid="conversation-view"] h1, [data-testid="conversation-view"] h2, [data-testid="conversation-view"] h3, [data-testid="conversation-view"] h4, [data-testid="conversation-view"] h5, [data-testid="conversation-view"] h6 { scroll-margin-top: 50px; }',
    '.bk-hl-border { outline: 3px solid #ff9800 !important; outline-offset: 2px; transition: outline 0.2s ease-in-out; }',
    '.bk-toc-active { background-color: #e8f0fe !important; border-radius: 3px; border-left: 3px solid #1a73e8 !important; padding-left: 8px !important; color: #1a73e8 !important; font-weight: bold; }',
    'a.bk-toc-link.bk-toc-clicked { background-color: #fff8e1 !important; border-radius: 3px; }',
    '.bk-toc-tree ul { list-style: none !important; padding: 0 !important; margin: 0 !important; }',
    '.bk-toc-tree li { list-style: none !important; margin: 0 !important; padding: 0 !important; }',
    '.bk-toc-tree ul ul { padding-left: 14px !important; border-left: 1px solid #e0e0e0 !important; margin-left: 6px !important; }',
    '.bk-toc-item-row { display: flex !important; flex-direction: row !important; align-items: baseline !important; padding: 2px 0 !important; width: 100% !important; box-sizing: border-box !important; }',
    '.bk-toc-toggle { width: 14px !important; height: 16px !important; flex-shrink: 0 !important; text-align: center !important; line-height: 16px !important; cursor: pointer !important; user-select: none !important; font-family: sans-serif !important; margin-right: 2px !important; color: #757575 !important; font-size: 10px !important; }',
    '.bk-toc-toggle:hover { color: #1a73e8 !important; }',
    '.bk-toc-toggle.empty { opacity: 0.3 !important; cursor: default !important; }',
    '.bk-toc-link { flex-grow: 1 !important; text-decoration: none !important; display: block !important; min-width: 0 !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px !important; line-height: 1.6 !important; padding: 1px 4px !important; color: #333333 !important; border-radius: 2px; }',
    '.bk-toc-link:hover { background-color: #f1f3f4 !important; color: #1a73e8 !important; }',
    '.bk-toc-link.prompt-item { font-weight: 600; color: #1a73e8 !important; }'
  ].join('\n');

  function injectStyle() {
    var styleId = 'ag_toc_style';
    var existingStyle = uiDoc.getElementById(styleId);
    if (!existingStyle) {
      var style = uiDoc.createElement('style');
      style.id = styleId;
      style.type = 'text/css';
      style.appendChild(uiDoc.createTextNode(cssContent));
      (uiDoc.head || uiDoc.body).appendChild(style);
    }
  }

  var container = null;
  var content = null;
  var headerBlock = null;
  var dockBtn = null;
  var headingLinks = [];
  var headingItems = [];

  function updateDockingState() {
    var target = getContentRoot();
    var width = (container && container.offsetWidth) || 340;
    if (isDocked) {
      target.style.paddingRight = width + 'px';
      target.style.transition = 'padding-right 0.2s ease';
      if (dockBtn) {
        dockBtn.style.background = '#1a73e8';
        dockBtn.style.color = '#fff';
        dockBtn.style.borderColor = '#1a73e8';
      }
    } else {
      target.style.paddingRight = '';
      if (dockBtn) {
        dockBtn.style.background = 'transparent';
        dockBtn.style.color = '#5f6368';
        dockBtn.style.borderColor = '#dadce0';
      }
    }
  }

  function highlightElement(el) {
    if (!el) return;
    el.classList.add('bk-hl-border');
    setTimeout(function() {
      el.classList.remove('bk-hl-border');
    }, 2000);
  }

  function markClickedElement(idx) {
    clickedId = idx;
    var prevs = content.querySelectorAll('a.bk-toc-clicked');
    prevs.forEach(function(el) {
      el.classList.remove('bk-toc-clicked');
    });
    if (idx !== null) {
      var targetLink = content.querySelector('a[data-index="' + idx + '"]');
      if (targetLink) targetLink.classList.add('bk-toc-clicked');
    }
  }

  function createTreeDOM(nodes) {
    if (!nodes || nodes.length === 0) return null;
    var ul = uiDoc.createElement('ul');

    nodes.forEach(function(node) {
      var item = node.item;
      var index = node.index;
      var li = uiDoc.createElement('li');

      var row = uiDoc.createElement('div');
      row.className = 'bk-toc-item-row';

      var toggle = uiDoc.createElement('span');
      toggle.className = 'bk-toc-toggle';

      var a = uiDoc.createElement('a');
      a.className = 'bk-toc-link';
      a.href = '#';
      a.dataset.index = index;

      var text = item.text;
      if (item.isPrompt) {
        a.classList.add('prompt-item');
        text = '👤 ' + text;
      } else {
        text = (node.children.length > 0 ? '📁 ' : '📄 ') + text;
      }
      if (text.length > 55) {
        text = text.substring(0, 55) + '...';
      }
      a.textContent = text;
      a.title = item.text;

      if (index === clickedId) {
        a.classList.add('bk-toc-clicked');
      }

      a.addEventListener('click', function(e) {
        e.preventDefault();
        if (item.el) {
          try {
            item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            highlightElement(item.el);
            markClickedElement(index);
          } catch(err) {}
        }
      });

      row.appendChild(toggle);
      row.appendChild(a);
      li.appendChild(row);

      if (node.children.length > 0) {
        var childUl = createTreeDOM(node.children);
        if (childUl) {
          li.appendChild(childUl);

          var exKey = 'node_' + index;
          var isExpanded = expandedState.hasOwnProperty(exKey)
            ? expandedState[exKey]
            : (node.treeDepth < currentMaxLevel);

          childUl.style.display = isExpanded ? 'block' : 'none';
          toggle.textContent = isExpanded ? '▼' : '▶';

          toggle.onclick = function(e) {
            e.stopPropagation();
            var isHidden = (childUl.style.display === 'none');
            childUl.style.display = isHidden ? 'block' : 'none';
            toggle.textContent = isHidden ? '▼' : '▶';
            expandedState[exKey] = isHidden;
          };
        }
      } else {
        toggle.textContent = '•';
        toggle.classList.add('empty');
      }

      ul.appendChild(li);
    });

    return ul;
  }

  function renderHeadings() {
    if (!content) return;
    headingLinks = [];
    headingItems = [];
    clearChildren(content);

    var items = extractItems();
    headingItems = items;

    if (items.length === 0) {
      var emptyDiv = uiDoc.createElement('div');
      emptyDiv.style.cssText = 'color:#70757a;padding:20px 10px;text-align:center;font-size:12px;line-height:1.6em;';
      var p1 = uiDoc.createElement('div');
      p1.textContent = '会話が見つかりません';
      p1.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#5f6368;';
      emptyDiv.appendChild(p1);
      content.appendChild(emptyDiv);
      return;
    }

    var tree = buildTree(items);
    var treeDom = createTreeDOM(tree.children);
    if (treeDom) {
      content.appendChild(treeDom);
    }
    headingLinks = Array.from(content.querySelectorAll('a.bk-toc-link'));
  }

  function highlightCurrentHeading() {
    if (!headingItems.length || !headingLinks.length || !content) return;
    var threshold = 150;
    var activeIndex = -1;

    for (var i = 0; i < headingItems.length; i++) {
      var h = headingItems[i].el;
      if (!h || h.offsetParent === null) continue;
      var rect = h.getBoundingClientRect();
      if (rect.top <= threshold) {
        activeIndex = i;
      } else {
        break;
      }
    }

    var currentActive = content.querySelector('.bk-toc-active');
    if (activeIndex !== -1 && currentActive && parseInt(currentActive.dataset.index, 10) === activeIndex) {
      return;
    }

    headingLinks.forEach(function(link) {
      link.classList.remove('bk-toc-active');
    });

    if (activeIndex !== -1) {
      var active = headingLinks.find(function(a) {
        return parseInt(a.dataset.index, 10) === activeIndex;
      });
      if (active) {
        active.classList.add('bk-toc-active');
        var panelRect = content.getBoundingClientRect();
        var linkRect = active.getBoundingClientRect();
        if (linkRect.top < panelRect.top || linkRect.bottom > panelRect.bottom) {
          active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }

  function initUI() {
    injectStyle();

    var existing = uiDoc.getElementById('ag_toc_container');
    if (existing) existing.remove();

    container = uiDoc.createElement('div');
    container.id = 'ag_toc_container';
    container.style.cssText = 'position:fixed;top:0;right:0;height:100%;max-height:100%;background:#ffffff;border-left:1px solid #dadce0;z-index:2147483647;font-size:12px;line-height:1.4em;box-shadow:-2px 0 8px rgba(0,0,0,0.12);min-width:240px;width:340px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;color:#202124;';

    headerBlock = uiDoc.createElement('div');
    headerBlock.style.cssText = 'flex-shrink:0;padding:34px 12px 8px 12px;background:#f8f9fa;border-bottom:1px solid #e0e0e0;';

    content = uiDoc.createElement('div');
    content.className = 'content bk-toc-tree';
    content.style.cssText = 'flex-grow:1;overflow-y:auto;padding:10px;min-height:0;overscroll-behavior:contain;scroll-behavior:smooth;background:#ffffff;';

    var filter = uiDoc.createElement('div');
    filter.style.cssText = 'margin-top:4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;';
    var filterLabel = uiDoc.createElement('span');
    filterLabel.textContent = '展開深度:';
    filterLabel.style.cssText = 'font-weight:bold;color:#5f6368;margin-right:4px;font-size:11px;';
    filter.appendChild(filterLabel);

    var levelBtns = [];
    for (var i = 1; i <= 6; i++) {
      (function(level) {
        var btn = uiDoc.createElement('button');
        btn.textContent = level;
        btn.title = '第 ' + level + ' 階層まで展開';
        btn.style.cssText = 'border:1px solid #dadce0; background:#f1f3f4; color:#3c4043; cursor:pointer; border-radius:3px; width:24px; height:24px; font-size:11px; padding:0; text-align:center; transition: all 0.15s; font-weight: 500;';
        btn.onclick = function() {
          currentMaxLevel = level;
          try { localStorage.setItem(STORAGE_KEY_LEVEL, currentMaxLevel); } catch(e){}
          updateLevelButtons();
          expandedState = {};
          renderHeadings();
          highlightCurrentHeading();
        };
        filter.appendChild(btn);
        levelBtns.push({ el: btn, level: level });
      })(i);
    }

    function updateLevelButtons() {
      levelBtns.forEach(function(item) {
        if (item.level === currentMaxLevel) {
          item.el.style.background = '#1a73e8';
          item.el.style.color = '#ffffff';
          item.el.style.borderColor = '#1a73e8';
          item.el.style.fontWeight = 'bold';
        } else if (item.level < currentMaxLevel) {
          item.el.style.background = '#e8f0fe';
          item.el.style.color = '#1a73e8';
          item.el.style.borderColor = '#d2e3fc';
          item.el.style.fontWeight = '500';
        } else {
          item.el.style.background = '#f1f3f4';
          item.el.style.color = '#70757a';
          item.el.style.borderColor = '#dadce0';
          item.el.style.fontWeight = 'normal';
        }
      });
    }

    var titleDiv = uiDoc.createElement('div');
    titleDiv.textContent = 'AntiGravity 会話目次';
    titleDiv.style.cssText = 'margin:2px 0 6px 0;font-weight:600;font-size:13px;color:#202124;';

    var close = uiDoc.createElement('button');
    close.textContent = '×';
    close.title = '閉じる (Alt+T で再表示)';
    close.style.cssText = 'position:absolute;top:6px;right:6px;background:#ea4335;color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-weight:bold;z-index:100;font-size:13px;line-height:22px;padding:0;text-align:center;';
    close.onclick = function() {
      if (isDocked) {
        isDocked = false;
        updateDockingState();
      }
      container.remove();
      container = null;
    };

    dockBtn = uiDoc.createElement('button');
    dockBtn.textContent = '📌';
    dockBtn.title = '右側に埋め込み (ドッキング)';
    dockBtn.style.cssText = 'position:absolute;top:6px;right:34px;background:transparent;color:#5f6368;border:1px solid #dadce0;border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:11px;z-index:100;line-height:20px;padding:0;text-align:center;';
    dockBtn.onclick = function() {
      isDocked = !isDocked;
      updateDockingState();
    };

    var refresh = uiDoc.createElement('button');
    refresh.textContent = '⟳';
    refresh.title = '最新の会話で更新';
    refresh.style.cssText = 'position:absolute;top:6px;left:34px;background:#1a73e8;color:#fff;border:none;border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:14px;z-index:100;line-height:20px;padding:0;text-align:center;font-family:sans-serif;';
    refresh.onclick = function() {
      renderHeadings();
      highlightCurrentHeading();
    };

    var toggle = uiDoc.createElement('button');
    toggle.textContent = '▼';
    toggle.title = 'パネル最小化 / 展開';
    toggle.style.cssText = 'position:absolute;top:6px;left:6px;background:#5f6368;color:#fff;border:none;border-radius:4px;width:22px;height:22px;cursor:pointer;font-weight:bold;font-size:11px;z-index:100;line-height:20px;padding:0;text-align:center;';
    var folded = false;
    toggle.onclick = function() {
      folded = !folded;
      headerBlock.style.display = folded ? 'none' : 'block';
      content.style.display = folded ? 'none' : 'block';
      container.style.height = folded ? '35px' : '100%';
      toggle.textContent = folded ? '▲' : '▼';
    };

    headerBlock.appendChild(titleDiv);
    headerBlock.appendChild(filter);
    container.appendChild(close);
    container.appendChild(dockBtn);
    container.appendChild(refresh);
    container.appendChild(toggle);
    container.appendChild(headerBlock);
    container.appendChild(content);

    uiDoc.body.appendChild(container);
    updateLevelButtons();
    renderHeadings();
    highlightCurrentHeading();

    uiDoc.addEventListener('scroll', highlightCurrentHeading, { passive: true, capture: true });
  }

  // ショートカットキー Alt + T でパネルを開閉
  window.addEventListener('keydown', function(e) {
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      if (container && container.parentElement) {
        container.remove();
        container = null;
      } else {
        initUI();
      }
    }
  });

  // 初回起動チェック（チャット画面がロードされるまで待機）
  function tryStart() {
    if (isChatFrame()) {
      initUI();
      return true;
    }
    return false;
  }

  if (!tryStart()) {
    var checkCount = 0;
    var timer = setInterval(function() {
      checkCount++;
      if (tryStart() || checkCount > 30) {
        clearInterval(timer);
      }
    }, 1000);
  }
})();
