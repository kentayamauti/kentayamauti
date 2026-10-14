(function () {
  'use strict';

  // Mobile navigation
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('global-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'メニューを開く');
      });
    });
  }

  // Self check
  var advice = {
    rosenka: '国税庁の路線価図で前面路線価を確認しましょう。15万円/㎡以下のエリアの土地値は「願望」になりやすく、強めの掛け目が必要です。',
    demo: '古家の解体費は建築費高騰の影響で上がっています。土地値から解体費を差し引いて買値を判断しましょう。',
    exitcost: '境界確定・分筆・不動産取得税・売却時の仲介手数料など、見落としがちな費用を試算に入れましょう。',
    market: '国土交通省の不動産情報ライブラリなどで、近隣の土地・戸建の成約価格を確認しましょう。',
    junction: '地方では主要国道の交差点付近以外は土地の買い手が付きにくい傾向です。幹線からの距離を確認しましょう。',
    hazard: '各市のハザードマップで浸水・高潮・土砂災害リスクを確認しましょう。保険料や入居付けにも影響します。',
    rebuild: '再建築不可の物件は土地値で売れません。接道状況と用途地域を必ず確認しましょう。',
    rent: 'ポータルサイトで周辺の戸建賃貸の募集家賃と掲載期間を調べ、想定家賃の根拠を持ちましょう。',
    reform: 'リフォーム費は膨らみがちです。見積りや過去の実績値をもとに予備費も含めて見込みましょう。',
    cash: '2戸同時の空室や大規模修繕が重なっても耐えられる手元資金を確保しておきましょう。'
  };

  var checkForm = document.getElementById('check-form');
  var checkResult = document.getElementById('check-result');
  if (checkForm && checkResult) {
    checkForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var boxes = checkForm.querySelectorAll('input[name="q"]');
      var total = boxes.length;
      var checked = 0;
      var missing = [];
      boxes.forEach(function (box) {
        if (box.checked) checked++;
        else missing.push(box.value);
      });

      var ratio = checked / total;
      var title, message;
      if (ratio >= 0.8) {
        title = '準備はかなり整っています';
        message = 'しっかり下調べができています。買付前に、第三者の目で土地値と出口を再確認するとさらに安心です。';
      } else if (ratio >= 0.5) {
        title = 'あと一歩、確認を深めましょう';
        message = '基本は押さえられています。抜けているポイントを補うことで、後悔のリスクを減らせます。';
      } else {
        title = 'まずは整理から始めましょう';
        message = '買付の前に、土地値と出口の確認が不足しています。下のポイントを押さえてから判断しましょう。';
      }

      var html = '<p class="score">' + checked + ' / ' + total + '</p>' +
        '<h3>' + title + '</h3><p>' + message + '</p>';
      if (missing.length) {
        html += '<p><strong>確認しておきたいポイント</strong></p><ul>' +
          missing.map(function (key) { return '<li>' + advice[key] + '</li>'; }).join('') +
          '</ul>';
      }
      html += '<a href="#contact" class="btn btn-primary">無料相談で詳しく聞く</a>';

      checkResult.innerHTML = html;
      checkResult.hidden = false;
      checkResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // Contact form (client-side validation only; connect to a backend/form service before going live)
  var contactForm = document.getElementById('contact-form');
  var formError = document.getElementById('form-error');
  var formDone = document.getElementById('form-done');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var errors = [];
      var fields = [
        { el: contactForm.name, msg: 'お名前を入力してください。' },
        { el: contactForm.email, msg: 'メールアドレスを正しく入力してください。' },
        { el: contactForm.topic, msg: 'ご相談内容を選択してください。' }
      ];
      fields.forEach(function (f) {
        var ok = f.el.value.trim() !== '' && f.el.checkValidity();
        f.el.classList.toggle('invalid', !ok);
        if (!ok) errors.push(f.msg);
      });
      if (!contactForm.privacy.checked) errors.push('個人情報の取り扱いへの同意が必要です。');

      if (errors.length) {
        formError.innerHTML = errors.join('<br>');
        formError.hidden = false;
        return;
      }
      formError.hidden = true;
      contactForm.hidden = true;
      formDone.hidden = false;
      formDone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // Land value simulator
  var AREA_LABEL = { kakogawa: '加古川市', takasago: '高砂市', himeji: '姫路市', amagasaki: '尼崎市' };
  var STORAGE_KEY = 'fudosan-sentei-candidates';
  var simForm = document.getElementById('sim-form');
  var lastResult = null;

  function num(form, name) {
    var v = parseFloat(form.elements[name].value);
    return isFinite(v) ? v : 0;
  }
  function man(yen) { return Math.round(yen / 10000).toLocaleString('ja-JP') + '万円'; }
  function pct(v) { return isFinite(v) ? v.toFixed(1) + '%' : '—'; }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function calc(f) {
    var price = num(f, 'price') * 10000;
    var land = num(f, 'land');
    var rosenka = num(f, 'rosenka');
    var floor = num(f, 'floor');
    var reform = num(f, 'reform') * 10000;
    var rentYear = num(f, 'rent') * 10000 * 12;
    var junction = f.elements.junction.checked;
    var boundary = f.elements.boundary.checked;
    var split = f.elements.split.checked;
    var LOW = 150000;

    // 路線価は時価の約8割の水準。15万円/㎡超は時価目安に割り戻し、以下は掛け目で割り引く
    var rosenkaValue = rosenka * land;
    var rate, basis;
    if (junction) {
      rate = num(f, 'junctionRate') / 100;
      basis = '主要国道の交差点付近：路線価土地値 × ' + Math.round(rate * 100) + '%';
    } else if (rosenka > LOW) {
      rate = 1 / 0.8;
      basis = '路線価15万円/㎡超：路線価 ÷ 0.8 で時価目安';
    } else {
      rate = num(f, 'lowRate') / 100;
      basis = '路線価15万円/㎡以下：土地値は願望になりやすいため × ' + Math.round(rate * 100) + '%';
    }
    var landValue = rosenkaValue * rate;

    var demoUnit = { wood: num(f, 'demoWood'), steel: num(f, 'demoSteel'), rc: num(f, 'demoRc') }[f.elements.structure.value];
    var demolition = floor * demoUnit;
    var boundaryCost = boundary ? 0 : num(f, 'boundaryCost') * 10000;
    var splitCost = split ? num(f, 'splitCost') * 10000 : 0;

    var grossExit = Math.max(landValue - demolition - boundaryCost - splitCost, 0);
    // 売却時の仲介手数料（400万円超の速算式。以下は上限額の目安として同式を適用）
    var brokerage = grossExit > 0 ? Math.min((grossExit * 0.03 + 60000) * 1.1, grossExit) : 0;
    var netLand = grossExit - brokerage;

    var buyCost = price * num(f, 'buyCostRate') / 100;
    var total = price + buyCost + reform;
    var margin = netLand - total;

    var gross = total > 0 ? rentYear / (price + reform) * 100 : NaN;
    var netIncome = rentYear * (1 - num(f, 'opexRate') / 100);
    var netYield = total > 0 ? netIncome / total * 100 : NaN;
    var payback = netIncome > 0 ? total / netIncome : Infinity;
    var marginYears = margin < 0 && netIncome > 0 ? -margin / netIncome : 0;

    var grade, label;
    if (margin >= 0 && (junction || rosenka > LOW)) { grade = 'A'; label = '土地値で下値が固い'; }
    else if (margin >= 0) { grade = 'B'; label = '土地値は残るが掛け目次第'; }
    else if (marginYears > 0 && marginYears <= 5) { grade = 'C'; label = '家賃回収で数年後に土地値を逃げられる'; }
    else { grade = 'D'; label = '土地値で逃げられない（見送り推奨）'; }

    var notes = [];
    if (!junction && rosenka <= LOW) notes.push('主要国道の交差点付近ではなく、路線価も15万円/㎡以下です。売却時に買い手が付きにくい可能性があります。');
    if (!boundary) notes.push('境界未確定のため、境界確定費を控除しています。売主負担で確定してもらえないか交渉余地があります。');
    if (split) notes.push('分筆費用を控除しています。分筆後の各区画が接道・最低敷地面積を満たすか確認してください。');
    if (gross < 10) notes.push('表面利回りが10%未満です。戸建投資としては低めのため、指値の検討をおすすめします。');
    if (f.elements.area.value === 'amagasaki') notes.push('尼崎市南部は高潮・浸水リスクの確認が特に重要です。');
    if (margin < 0) notes.push('土地値ベースで ' + man(-margin) + ' 不足。この金額だけ購入価格を下げられれば安全圏です。');

    return {
      area: f.elements.area.value, price: price, total: total, rosenkaValue: rosenkaValue, basis: basis,
      landValue: landValue, demolition: demolition, boundaryCost: boundaryCost, splitCost: splitCost,
      brokerage: brokerage, netLand: netLand, buyCost: buyCost, reform: reform, margin: margin,
      gross: gross, netYield: netYield, payback: payback, marginYears: marginYears,
      grade: grade, label: label, notes: notes
    };
  }

  function render(r) {
    document.getElementById('sim-verdict').innerHTML =
      '<span class="grade grade-' + r.grade + '">' + r.grade + '</span>' +
      '<div><p class="verdict-label">' + r.label + '</p>' +
      '<p class="verdict-margin">土地値マージン <strong class="' + (r.margin >= 0 ? 'pos' : 'neg') + '">' +
      (r.margin >= 0 ? '+' : '−') + man(Math.abs(r.margin)) + '</strong></p></div>';

    var rows = [
      ['路線価 × 面積', man(r.rosenkaValue), ''],
      ['評価土地値', man(r.landValue), r.basis],
      ['− 解体費', man(r.demolition), ''],
      ['− 境界確定費', man(r.boundaryCost), ''],
      ['− 分筆費用', man(r.splitCost), ''],
      ['− 売却時仲介手数料', man(r.brokerage), ''],
      ['実質土地値（手残り）', man(r.netLand), '', 'strong'],
      ['購入価格', man(r.price), ''],
      ['＋ 購入諸費用（取得税等）', man(r.buyCost), ''],
      ['＋ リフォーム費', man(r.reform), ''],
      ['購入総額', man(r.total), '', 'strong'],
      ['表面利回り', pct(r.gross), ''],
      ['実質利回り（経費控除後）', pct(r.netYield), ''],
      ['投資回収期間', isFinite(r.payback) ? r.payback.toFixed(1) + '年' : '—', ''],
      ['土地値まで回収', r.margin >= 0 ? '購入時点で到達' : (r.marginYears > 0 ? r.marginYears.toFixed(1) + '年' : '—'), '']
    ];
    document.getElementById('sim-table').innerHTML = rows.map(function (row) {
      return '<tr class="' + (row[3] || '') + '"><th>' + row[0] + (row[2] ? '<small>' + row[2] + '</small>' : '') +
        '</th><td>' + row[1] + '</td></tr>';
    }).join('');
    document.getElementById('sim-notes').innerHTML = r.notes.map(function (n) { return '<li>' + n + '</li>'; }).join('');
  }

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; }
  }
  function storeSaved(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }
  var saved = loadSaved();

  function renderSaved() {
    var wrap = document.getElementById('sim-saved-wrap');
    wrap.hidden = saved.length === 0;
    document.getElementById('sim-saved').innerHTML = saved.map(function (c, i) {
      return '<tr><td>' + esc(c.name) + '</td><td>' + AREA_LABEL[c.area] + '</td><td>' + man(c.total) +
        '</td><td>' + man(c.netLand) + '</td><td class="' + (c.margin >= 0 ? 'pos' : 'neg') + '">' +
        (c.margin >= 0 ? '+' : '−') + man(Math.abs(c.margin)) + '</td><td>' + pct(c.gross) +
        '</td><td><span class="grade grade-sm grade-' + c.grade + '">' + c.grade + '</span></td>' +
        '<td><button type="button" class="link-btn" data-remove="' + i + '">削除</button></td></tr>';
    }).join('');
  }

  if (simForm) {
    var update = function () { lastResult = calc(simForm); render(lastResult); };
    simForm.addEventListener('input', update);
    simForm.addEventListener('change', update);
    simForm.addEventListener('submit', function (e) { e.preventDefault(); });
    update();

    document.getElementById('sim-save').addEventListener('click', function () {
      if (!lastResult) return;
      var nameInput = document.getElementById('sim-name');
      saved.push({
        name: nameInput.value.trim() || '候補' + (saved.length + 1),
        area: lastResult.area, total: lastResult.total, netLand: lastResult.netLand,
        margin: lastResult.margin, gross: lastResult.gross, grade: lastResult.grade
      });
      nameInput.value = '';
      storeSaved(saved);
      renderSaved();
    });
    document.getElementById('sim-saved').addEventListener('click', function (e) {
      var idx = e.target.getAttribute('data-remove');
      if (idx === null) return;
      saved.splice(Number(idx), 1);
      storeSaved(saved);
      renderSaved();
    });
    renderSaved();
  }

  // Address lookup: geocode with GSI address search, then build research links
  var AREA_BY_CITY = { '加古川市': 'kakogawa', '高砂市': 'takasago', '姫路市': 'himeji', '尼崎市': 'amagasaki' };
  var geoInput = document.getElementById('geo-address');
  var geoButton = document.getElementById('geo-search');
  var geoStatus = document.getElementById('geo-status');
  var geoLinks = document.getElementById('geo-links');
  var currentAddress = '';

  function setLink(id, href) { document.getElementById(id).href = href; }

  function detectArea(text) {
    for (var city in AREA_BY_CITY) {
      if (text.indexOf(city) !== -1) return AREA_BY_CITY[city];
    }
    return null;
  }

  function applyArea(text) {
    var area = detectArea(text);
    if (area && simForm) {
      simForm.elements.area.value = area;
      simForm.dispatchEvent(new Event('change'));
    }
    return area;
  }

  function showLinks(address, lat, lon) {
    currentAddress = address;
    var q = encodeURIComponent(address);
    setLink('geo-gmap', 'https://www.google.com/maps/search/?api=1&query=' + (lat ? lat + ',' + lon : q));
    if (lat) {
      setLink('geo-street', 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + lat + ',' + lon);
      setLink('geo-hazard', 'https://disaportal.gsi.go.jp/maps/?ll=' + lat + ',' + lon + '&z=16&base=pale');
      setLink('geo-gsi', 'https://maps.gsi.go.jp/#17/' + lat + '/' + lon + '/');
    } else {
      setLink('geo-street', 'https://www.google.com/maps/search/?api=1&query=' + q);
      setLink('geo-hazard', 'https://disaportal.gsi.go.jp/');
      setLink('geo-gsi', 'https://maps.gsi.go.jp/');
    }
    geoLinks.hidden = false;
    var memo = document.getElementById('sim-name');
    if (memo && !memo.value) memo.value = address.replace(/^兵庫県/, '');
  }

  function geocode() {
    var address = geoInput.value.trim();
    if (!address) { geoStatus.textContent = '住所を入力してください。'; return; }
    geoStatus.textContent = '検索中…';
    geoButton.disabled = true;
    fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(address))
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then(function (list) {
        if (!list || !list.length) throw new Error('not found');
        var hit = list[0];
        var lon = hit.geometry.coordinates[0].toFixed(6);
        var lat = hit.geometry.coordinates[1].toFixed(6);
        var title = hit.properties.title || address;
        var area = applyArea(title) || applyArea(address);
        geoStatus.innerHTML = '📍 ' + esc(title) + '（' + lat + ', ' + lon + '）' +
          (area ? '' : '<br>※ 対象4市（加古川・高砂・姫路・尼崎）以外の可能性があります。');
        showLinks(address, lat, lon);
      })
      .catch(function () {
        applyArea(address);
        geoStatus.textContent = '位置を特定できませんでした。住所で各サイトを開けるようにしています。';
        showLinks(address, null, null);
      })
      .then(function () { geoButton.disabled = false; });
  }

  if (geoButton) {
    geoButton.addEventListener('click', geocode);
    geoInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); geocode(); }
    });
    geoLinks.querySelectorAll('[data-copy]').forEach(function (a) {
      a.addEventListener('click', function () {
        if (currentAddress && navigator.clipboard) {
          navigator.clipboard.writeText(currentAddress).catch(function () {});
        }
      });
    });
  }

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
