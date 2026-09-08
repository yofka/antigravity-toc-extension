(function() {
  function isChatFrame() {
    return !!document.querySelector('[data-testid="conversation-view"], [data-testid="user-input-step"], [aria-label="User message"]');
  }

  var STORAGE_KEY_LEVEL = 'ag_toc_level';
  var STORAGE_KEY_WRAP = 'ag_toc_wrap';
  var STORAGE_KEY_FOLDED = 'ag_toc_folded';

  var currentMaxLevel = parseInt(localStorage.getItem(STORAGE_KEY_LEVEL), 10) || 2;
  var isWrap = localStorage.getItem(STORAGE_KEY_WRAP) === 'true'; // デフォルトは false (1行表示)
  var isFolded = localStorage.getItem(STORAGE_KEY_FOLDED) === 'true';

  var clickedId = null;
  var expandedState = {};
  var expandedTextMap = {};
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
      return !el.closest('#ag_toc_container') && !el.closest('#ag_toc_mini_btn');
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
    '[data-testid="conversation-view"] [data-testid="user-input-step"], [data-testid="conversation-view"] h1, [data-testid="conversation-view"] h2, [data-testid="conversation-view"] h3, [data-testid="conversation-view"] h4, [data-testid="conversation-view"] h5, [data-testid="conversation-view"] h6 { scroll-margin-top: 55px; }',
    '.bk-hl-border { outline: 3px solid #ff9800 !important; outline-offset: 2px; transition: outline 0.2s ease-in-out; }',
    '.bk-toc-active { background-color: #e8f0fe !important; border-radius: 3px; border-left: 3px solid #1a73e8 !important; padding-left: 8px !important; color: #1a73e8 !important; font-weight: bold; }',
    'a.bk-toc-link.bk-toc-clicked { background-color: #fff8e1 !important; border-radius: 3px; }',
    '.bk-toc-tree ul { list-style: none !important; padding: 0 !important; margin: 0 !important; }',
    '.bk-toc-tree li { list-style: none !important; margin: 0 !important; padding: 0 !important; }',
    '.bk-toc-tree ul ul { padding-left: 14px !important; border-left: 1px solid #e0e0e0 !important; margin-left: 6px !important; }',
    '.bk-toc-item-row { display: flex !important; flex-direction: row !important; align-items: flex-start !important; padding: 2px 0 !important; width: 100% !important; box-sizing: border-box !important; }',
    '.bk-toc-toggle { width: 14px !important; height: 16px !important; flex-shrink: 0 !important; text-align: center !important; line-height: 16px !important; cursor: pointer !important; user-select: none !important; font-family: sans-serif !important; margin-right: 2px !important; color: #757575 !important; font-size: 10px !important; margin-top: 2px !important; }',
    '.bk-toc-toggle:hover { color: #1a73e8 !important; }',
    '.bk-toc-toggle.empty { opacity: 0.3 !important; cursor: default !important; }',
    /* デフォルト: 1行で見切れて省略記号 (...) */
    '.bk-toc-link { flex-grow: 1 !important; text-decoration: none !important; display: block !important; min-width: 0 !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; font-size: 12px !important; line-height: 1.6 !important; padding: 1px 4px !important; color: #333333 !important; border-radius: 2px; }',
    '.bk-toc-link:hover { background-color: #f1f3f4 !important; color: #1a73e8 !important; }',
    '.bk-toc-link.prompt-item { font-weight: 600; color: #1a73e8 !important; }',
    /* Wrap モード: 初期は4行までに制限 */
    '#ag_toc_container.bk-toc-wrap-mode .bk-toc-link { white-space: normal !important; display: -webkit-box !important; -webkit-box-orient: vertical !important; -webkit-line-clamp: 4 !important; overflow: hidden !important; text-overflow: ellipsis !important; word-break: break-word !important; overflow-wrap: anywhere !important; }',
    /* Wrap モード: 展開表示 (末尾まで全行表示) */
    '#ag_toc_container.bk-toc-wrap-mode .bk-toc-link.bk-toc-expanded { display: block !important; -webkit-line-clamp: unset !important; overflow: visible !important; }',
    /* 「...」展開ボタン */
    '.bk-toc-more-btn { display: none !important; flex-shrink: 0 !important; margin-left: 4px !important; align-self: flex-end !important; background: #f1f3f4 !important; color: #5f6368 !important; border: 1px solid #dadce0 !important; border-radius: 3px !important; font-size: 10px !important; line-height: 14px !important; height: 16px !important; padding: 0 4px !important; cursor: pointer !important; user-select: none !important; font-family: monospace, sans-serif !important; box-sizing: border-box !important; transition: all 0.15s ease !important; }',
    '.bk-toc-more-btn:hover { background: #e8f0fe !important; color: #1a73e8 !important; border-color: #1a73e8 !important; }',
    '#ag_toc_container.bk-toc-wrap-mode .bk-toc-more-btn.has-overflow { display: inline-flex !important; align-items: center !important; justify-content: center !important; }',
    /* 展開時: 見出し行エリアの高さいっぱいの縦長ボタン */
    '#ag_toc_container.bk-toc-wrap-mode .bk-toc-more-btn.is-expanded { align-self: stretch !important; height: auto !important; min-height: 100% !important; width: 18px !important; padding: 4px 0 !important; display: inline-flex !important; flex-direction: column !important; justify-content: space-between !important; align-items: center !important; background: #f1f3f4 !important; color: #1a73e8 !important; border: 1px solid #dadce0 !important; border-radius: 3px !important; font-size: 10px !important; font-weight: bold !important; cursor: pointer !important; user-select: none !important; box-sizing: border-box !important; transition: all 0.15s ease !important; }',
    '#ag_toc_container.bk-toc-wrap-mode .bk-toc-more-btn.is-expanded:hover { background: #e8f0fe !important; color: #1557b0 !important; border-color: #1a73e8 !important; }',
    '#ag_toc_container button:hover { opacity: 0.85; }'
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
  var miniBtn = null;
  var content = null;
  var dockBtn = null;
  var wrapBtn = null;
  var headingLinks = [];
  var headingItems = [];

  function updateDockingState() {
    var target = getContentRoot();
    var width = (container && container.offsetWidth) || 340;
    if (isDocked && !isFolded && container && container.style.display !== 'none') {
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
        dockBtn.style.background = isDocked ? '#e8f0fe' : 'transparent';
        dockBtn.style.color = isDocked ? '#1a73e8' : '#5f6368';
        dockBtn.style.borderColor = isDocked ? '#1a73e8' : '#dadce0';
      }
    }
  }

  function setButtonState(btn, isExp) {
    clearChildren(btn);
    if (isExp) {
      btn.classList.add('is-expanded');
      btn.title = '4行に折りたたむ';
      var a1 = uiDoc.createElement('span'); a1.textContent = '▲';
      var a2 = uiDoc.createElement('span'); a2.textContent = '▲';
      var a3 = uiDoc.createElement('span'); a3.textContent = '▲';
      btn.appendChild(a1);
      btn.appendChild(a2);
      btn.appendChild(a3);
    } else {
      btn.classList.remove('is-expanded');
      btn.textContent = '...';
      btn.title = '末尾まで展開';
    }
  }

  function updateOverflowButtons() {
    if (!content) return;
    var rows = content.querySelectorAll('.bk-toc-item-row');
    rows.forEach(function(row) {
      var a = row.querySelector('.bk-toc-link');
      var btn = row.querySelector('.bk-toc-more-btn');
      if (!a || !btn) return;
      var idx = a.dataset.index;
      var isExp = !!expandedTextMap[idx];
      setButtonState(btn, isExp);
      if (isExp) {
        a.classList.add('bk-toc-expanded');
        btn.classList.add('has-overflow');
      } else {
        a.classList.remove('bk-toc-expanded');
        if (isWrap && container && container.classList.contains('bk-toc-wrap-mode')) {
          if (a.scrollHeight > a.clientHeight + 2) {
            btn.classList.add('has-overflow');
          } else {
            btn.classList.remove('has-overflow');
          }
        } else {
          btn.classList.remove('has-overflow');
        }
      }
    });
  }

  function updateWrapState() {
    if (!container || !wrapBtn) return;
    if (isWrap) {
      container.classList.add('bk-toc-wrap-mode');
      wrapBtn.style.background = '#1a73e8';
      wrapBtn.style.color = '#ffffff';
      wrapBtn.style.borderColor = '#1a73e8';
      wrapBtn.style.fontWeight = 'bold';
      wrapBtn.title = '折り返し表示中 (クリックで1行表示に変更)';
    } else {
      container.classList.remove('bk-toc-wrap-mode');
      wrapBtn.style.background = '#f1f3f4';
      wrapBtn.style.color = '#5f6368';
      wrapBtn.style.borderColor = '#dadce0';
      wrapBtn.style.fontWeight = 'normal';
      wrapBtn.title = '1行表示中 (クリックで折り返し表示に変更)';
    }
    updateOverflowButtons();
    setTimeout(updateOverflowButtons, 0);
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
      var moreBtn = uiDoc.createElement('button');
      moreBtn.className = 'bk-toc-more-btn';
      moreBtn.textContent = '...';
      moreBtn.title = '末尾まで展開';
      moreBtn.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        var isExp = !expandedTextMap[index];
        expandedTextMap[index] = isExp;
        setButtonState(moreBtn, isExp);
        if (isExp) {
          a.classList.add('bk-toc-expanded');
        } else {
          a.classList.remove('bk-toc-expanded');
        }
        moreBtn.classList.add('has-overflow');
      };

      row.appendChild(toggle);
      row.appendChild(a);
      row.appendChild(moreBtn);
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
    updateOverflowButtons();
    setTimeout(updateOverflowButtons, 0);
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

  // 小さなシェード（最小化）ボタンの作成・表示
  function showMiniBtn() {
    if (!miniBtn) {
      miniBtn = uiDoc.createElement('button');
      miniBtn.id = 'ag_toc_mini_btn';
      miniBtn.title = '目次パネルを展開 (Alt+T)';
      miniBtn.style.cssText = 'position:fixed;top:50px;right:10px;z-index:2147483647;background:#1a73e8;color:#ffffff;border:1px solid #1557b0;border-radius:14px;height:28px;padding:0 10px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,0.25);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;transition:all 0.15s ease;';
      miniBtn.textContent = '📑 目次 ▲';
      miniBtn.onclick = function() {
        expandPanel();
      };
      miniBtn.onmouseenter = function() {
        miniBtn.style.background = '#1557b0';
        miniBtn.style.transform = 'scale(1.03)';
      };
      miniBtn.onmouseleave = function() {
        miniBtn.style.background = '#1a73e8';
        miniBtn.style.transform = 'none';
      };
      uiDoc.body.appendChild(miniBtn);
    } else {
      miniBtn.style.display = 'flex';
    }
  }

  function hideMiniBtn() {
    if (miniBtn) {
      miniBtn.style.display = 'none';
    }
  }

  // パネルの最小化（シェード）: 340pxの領域は完全に隠し、小さなボタンだけ描画！
  function foldPanel() {
    isFolded = true;
    try { localStorage.setItem(STORAGE_KEY_FOLDED, 'true'); } catch(e){}
    if (container) {
      container.style.display = 'none';
    }
    updateDockingState();
    showMiniBtn();
  }

  // パネルの展開
  function expandPanel() {
    isFolded = false;
    try { localStorage.setItem(STORAGE_KEY_FOLDED, 'false'); } catch(e){}
    hideMiniBtn();
    if (!container) {
      initUI();
    } else {
      container.style.display = 'flex';
      updateDockingState();
      renderHeadings();
      highlightCurrentHeading();
    }
  }

  function initUI() {
    injectStyle();

    var existing = uiDoc.getElementById('ag_toc_container');
    if (existing) existing.remove();

    // パネルコンテナ: top: 44px により、Antigravity最上部のヘッダーバーやアカウントアイコンを完全に回避！
    container = uiDoc.createElement('div');
    container.id = 'ag_toc_container';
    container.style.cssText = 'position:fixed;top:44px;right:0;height:calc(100% - 44px);max-height:calc(100% - 44px);background:#ffffff;border-left:1px solid #dadce0;z-index:2147483647;font-size:12px;line-height:1.4em;box-shadow:-2px 0 8px rgba(0,0,0,0.12);min-width:240px;width:340px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;color:#202124;box-sizing:border-box;';

    // ヘッダー部全体
    var headerBlock = uiDoc.createElement('div');
    headerBlock.style.cssText = 'flex-shrink:0;background:#f8f9fa;border-bottom:1px solid #e0e0e0;box-sizing:border-box;';

    // 1段目: タイトルとツールバーボタン群（Flexbox配置で重なりゼロ）
    var topBar = uiDoc.createElement('div');
    topBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px 6px 10px;';

    var titleDiv = uiDoc.createElement('div');
    titleDiv.textContent = 'AntiGravity 会話目次';
    titleDiv.style.cssText = 'font-weight:600;font-size:13px;color:#202124;white-space:nowrap;user-select:none;';

    var actionsDiv = uiDoc.createElement('div');
    actionsDiv.style.cssText = 'display:flex;align-items:center;gap:4px;';

    // 最小化 (シェード) ボタン
    var shadeBtn = uiDoc.createElement('button');
    shadeBtn.textContent = '▼';
    shadeBtn.title = 'パネル最小化 (小さなボタンに縮小)';
    shadeBtn.style.cssText = 'background:#5f6368;color:#fff;border:none;border-radius:4px;width:22px;height:22px;cursor:pointer;font-weight:bold;font-size:10px;line-height:20px;padding:0;text-align:center;';
    shadeBtn.onclick = function() {
      foldPanel();
    };

    // 再更新ボタン
    var refreshBtn = uiDoc.createElement('button');
    refreshBtn.textContent = '⟳';
    refreshBtn.title = '最新の会話で更新';
    refreshBtn.style.cssText = 'background:#1a73e8;color:#fff;border:none;border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:14px;line-height:20px;padding:0;text-align:center;font-family:sans-serif;';
    refreshBtn.onclick = function() {
      renderHeadings();
      highlightCurrentHeading();
    };

    // ドッキングボタン
    dockBtn = uiDoc.createElement('button');
    dockBtn.textContent = '📌';
    dockBtn.title = '右側に埋め込み (ドッキング切替)';
    dockBtn.style.cssText = 'background:transparent;color:#5f6368;border:1px solid #dadce0;border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:11px;line-height:20px;padding:0;text-align:center;';
    dockBtn.onclick = function() {
      isDocked = !isDocked;
      updateDockingState();
    };

    // 閉じるボタン
    var closeBtn = uiDoc.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = '閉じる (Alt+T で再表示)';
    closeBtn.style.cssText = 'background:#ea4335;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-weight:bold;font-size:12px;line-height:20px;padding:0;text-align:center;margin-left:2px;';
    closeBtn.onclick = function() {
      if (isDocked) {
        isDocked = false;
        updateDockingState();
      }
      container.remove();
      container = null;
      hideMiniBtn();
    };

    actionsDiv.appendChild(shadeBtn);
    actionsDiv.appendChild(refreshBtn);
    actionsDiv.appendChild(dockBtn);
    actionsDiv.appendChild(closeBtn);

    topBar.appendChild(titleDiv);
    topBar.appendChild(actionsDiv);

    // 2段目: 展開深度 (Depth 1〜6) + Wrap (折り返し) ボタン
    var controlBar = uiDoc.createElement('div');
    controlBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 10px 8px 10px;gap:6px;border-top:1px solid #f1f3f4;';

    var depthGroup = uiDoc.createElement('div');
    depthGroup.style.cssText = 'display:flex;align-items:center;gap:3px;';

    var filterLabel = uiDoc.createElement('span');
    filterLabel.textContent = '深度:';
    filterLabel.style.cssText = 'font-weight:bold;color:#5f6368;margin-right:2px;font-size:11px;';
    depthGroup.appendChild(filterLabel);

    var levelBtns = [];
    for (var i = 1; i <= 6; i++) {
      (function(level) {
        var btn = uiDoc.createElement('button');
        btn.textContent = level;
        btn.title = '第 ' + level + ' 階層まで展開';
        btn.style.cssText = 'border:1px solid #dadce0; background:#f1f3f4; color:#3c4043; cursor:pointer; border-radius:3px; width:22px; height:22px; font-size:11px; padding:0; text-align:center; transition:all 0.15s; font-weight:500;';
        btn.onclick = function() {
          currentMaxLevel = level;
          try { localStorage.setItem(STORAGE_KEY_LEVEL, currentMaxLevel); } catch(e){}
          updateLevelButtons();
          expandedState = {};
          renderHeadings();
          highlightCurrentHeading();
        };
        depthGroup.appendChild(btn);
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

    // Wrap ボタン
    wrapBtn = uiDoc.createElement('button');
    wrapBtn.textContent = 'Wrap';
    wrapBtn.style.cssText = 'border:1px solid #dadce0; border-radius:3px; height:22px; padding:0 8px; font-size:11px; cursor:pointer; transition:all 0.15s; font-family:sans-serif;';
    wrapBtn.onclick = function() {
      isWrap = !isWrap;
      try { localStorage.setItem(STORAGE_KEY_WRAP, isWrap); } catch(e){}
      updateWrapState();
    };

    controlBar.appendChild(depthGroup);
    controlBar.appendChild(wrapBtn);

    headerBlock.appendChild(topBar);
    headerBlock.appendChild(controlBar);

    // 目次ツリー表示部
    content = uiDoc.createElement('div');
    content.className = 'content bk-toc-tree';
    content.style.cssText = 'flex-grow:1;overflow-y:auto;padding:10px;min-height:0;overscroll-behavior:contain;scroll-behavior:smooth;background:#ffffff;';

    container.appendChild(headerBlock);
    container.appendChild(content);

    uiDoc.body.appendChild(container);

    updateLevelButtons();
    updateWrapState();
    updateDockingState();
    renderHeadings();
    highlightCurrentHeading();

    uiDoc.addEventListener('scroll', highlightCurrentHeading, { passive: true, capture: true });
    window.addEventListener('resize', updateOverflowButtons, { passive: true });

    if (isFolded) {
      foldPanel();
    }
  }

  // ショートカットキー Alt + T で開閉（最小化と展開をトグル）
  window.addEventListener('keydown', function(e) {
    if (e.altKey && (e.key === 't' || e.key === 'T')) {
      if (isFolded || !container || container.style.display === 'none') {
        expandPanel();
      } else {
        foldPanel();
      }
    }
  });

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
