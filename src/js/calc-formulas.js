/*
 * Формулы калькуляторов. window.CALC['<код>'] принимает входы в СИ и возвращает выходы в СИ.
 * Опирается на window.SteamProps (IAPWS-IF97) и window.PIPE_TABLE (типоразмеры труб).
 * Видимые формулы взяты из formulas/tlv_app_reverse/calculators.json; коэффициент трения и
 * эквивалентные длины фитингов отсутствовали в данных — восстановлены стандартными корреляциями
 * и откалиброваны по эталонным расчётам TLV ToolBox.
 * Конкатенируется в build/js/main.js — без import/export.
 */
(function () {
  'use strict';

  // Глобалы резолвятся лениво (в момент вызова): при конкатенации этот файл идёт раньше
  // calc-steam-if97.js / calc-pipes-data.js, поэтому на этапе загрузки их ещё нет.
  function steam() { return (typeof window !== 'undefined' && window.SteamProps); }
  function pipes() { return (typeof window !== 'undefined' && window.PIPE_TABLE); }

  // Поправочный множитель трения: подгонка под TLV ToolBox (λ_TLV/λ_Колбрук = 1.006,
  // константа по 5 калибровочным точкам, Re 1.3e5..7e5, V 0.095..0.60).
  var FRICTION_CORR = 1.006;

  // Коэффициент трения Дарси по Колбрук-Уайту (итерация) с поправкой. epsd = ε/d.
  function colebrook(Re, epsd) {
    if (Re < 2300) return 64 / Re; // ламинарный режим
    var f = 0.02;
    for (var i = 0; i < 60; i++) {
      f = Math.pow(-2 * Math.log10(epsd / 3.7 + 2.51 / (Re * Math.sqrt(f))), -2);
    }
    return f * FRICTION_CORR;
  }

  // Коэффициенты местных сопротивлений K (метод TLV: L_eq = n·K·d/f).
  // Откалиброваны по эталонным расчётам TLV ToolBox (классические значения Crane).
  var K = { obsFlo: 10.5, thruFlo: 0.20, check: 2.40, elbow: 1.00 };
  function fittingsLength(d, f, fit) {
    fit = fit || {};
    var sumK = K.obsFlo * (fit.obsFlo || 0) + K.thruFlo * (fit.thruFlo || 0) +
      K.check * (fit.check || 0) + K.elbow * (fit.elbow || 0);
    return sumK * d / f; // эквивалентная длина фитингов, м
  }

  // Удельный объём пара V (м³/кг) и температура T (К): насыщение либо перегрев.
  function steamState(Pabs, Tk) {
    var S = steam(), Ts = S.Tsat(Pabs);
    if (Tk && Tk > Ts + 0.1) return { V: S.superheated(Pabs, Tk).v, T: Tk };
    return { V: S.satVapor(Pabs).v, T: Ts };
  }

  // Гидравлика для известной скорости v (м/с): Re, трение, эквивалентная длина, потери давления.
  // Универсально для любого флюида (V=уд. объём=1/ρ, eta=динам. вязкость Па·с).
  function hydraulics(d, v, V, eta, pipeLen, fit, eps) {
    var Re = v * d / (V * eta);
    var lam = colebrook(Re, eps / d);
    var leq = pipeLen + fittingsLength(d, lam, fit);
    var dp = lam * leq * v * v / (2 * d * V); // Па
    return { v: v, dp: dp, lam: lam, Re: Re, leq: leq };
  }
  // Скорость по массовому расходу (кг/ч) + потери (для пара).
  function velAndLoss(d, ms, V, eta, pipeLen, fit, eps) {
    var v = ms / 3600 * V / (Math.pow(d / 2, 2) * Math.PI);
    return hydraulics(d, v, V, eta, pipeLen, fit, eps);
  }
  function pipeArea(d) { return Math.pow(d / 2, 2) * Math.PI; }

  // ---- Свойства воды и газов ----
  // Удельный объём воды V (м³/кг) по T(К), p(МПа) — из IAPWS-IF97 область 1.
  function waterV(Pabs, Tk) { return steam().region1(Pabs, Tk).v; }
  // Динамическая вязкость воды (Па·с) по T(К). Корреляция 2.414e-5·10^(247.8/(T-140)).
  function waterVisc(Tk) { return 2.414e-5 * Math.pow(10, 247.8 / (Tk - 140)); }
  // Плотность воздуха (кг/м³): идеальный газ, R_возд=287.05 Дж/(кг·К). P в Па.
  function airRho(Ppa, Tk) { return Ppa / (287.05 * Tk); }
  // Динамическая вязкость воздуха (Па·с) — формула Сазерленда.
  function airVisc(Tk) { return 1.716e-5 * Math.pow(Tk / 273.15, 1.5) * (273.15 + 110.4) / (Tk + 110.4); }
  // Плотность произвольного газа (кг/м³): ρ=P·M/(R·T), M г/моль, P в Па.
  function gasRho(Ppa, Mgmol, Tk) { return Ppa * (Mgmol / 1000) / (8.31446 * Tk); }

  var CALC = {};

  /*
   * 11110 — Расчёт размера трубы по допустимым потерям давления (пар).
   * Вход (СИ): pipeGrade(idx), stmPress(МПа абс), stmTemp(К|null), stmFlow(кг/ч),
   *            allowPressLoss(Па), pipeLen(м), fittings{obsFlo,thruFlo,check,elbow}, pipeRough(м).
   * Выход (СИ): pipeSize(label), pipeInDiam(м), stmVelo(м/с), pressLoss(Па), equivLen(м), exceeded(bool).
   */
  CALC['11110'] = function (inp) {
    var S = steam(), PIPES = pipes();
    var st = steamState(inp.stmPress, inp.stmTemp);
    var V = st.V, eta = S.viscosity(1 / V, st.T);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var list = PIPES[inp.pipeGrade] || PIPES[7];
    var chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000; // мм -> м
      var r = velAndLoss(d, inp.stmFlow, V, eta, inp.pipeLen, inp.fittings, eps);
      if (r.dp <= inp.allowPressLoss) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { // ни одна труба не проходит — берём наибольшую
      var last = list[list.length - 1], dd = last.id / 1000;
      chosen = { pipe: last, d: dd, r: velAndLoss(dd, inp.stmFlow, V, eta, inp.pipeLen, inp.fittings, eps) };
      exceeded = true;
    }
    return {
      pipeSize: formatSize(inp.pipeGrade, chosen.pipe),
      pipeInDiam: chosen.d,            // м
      stmVelo: chosen.r.v,             // м/с
      pressLoss: chosen.r.dp,          // Па
      equivLen: chosen.r.leq,          // м
      exceeded: exceeded
    };
  };

  /*
   * 11150 — Скорость пара в трубе заданного диаметра.
   * Вход: pipeInDiam(м), stmPress(МПа абс), stmTemp(К|null), stmFlow(кг/ч). Выход: stmVelo(м/с).
   */
  CALC['11150'] = function (inp) {
    var V = steamState(inp.stmPress, inp.stmTemp).V;
    return { stmVelo: inp.stmFlow / 3600 * V / (Math.pow(inp.pipeInDiam / 2, 2) * Math.PI) };
  };

  /*
   * 11160 — Расход пара по скорости в трубе заданного диаметра.
   * Вход: pipeInDiam(м), stmPress, stmTemp, stmVelo(м/с). Выход: stmFlow(кг/ч).
   */
  CALC['11160'] = function (inp) {
    var V = steamState(inp.stmPress, inp.stmTemp).V;
    return { stmFlow: inp.stmVelo * Math.pow(inp.pipeInDiam / 2, 2) * Math.PI / V * 3600 };
  };

  /*
   * 11140 — Скорость и потери давления для трубы ЗАДАННОГО диаметра.
   * Вход: pipeInDiam(м), stmPress, stmTemp, stmFlow(кг/ч), pipeLen(м), fittings, pipeRough(м).
   * Выход: stmVelo(м/с), pressLoss(Па), equivLen(м).
   */
  CALC['11140'] = function (inp) {
    var S = steam();
    var st = steamState(inp.stmPress, inp.stmTemp);
    var eta = S.viscosity(1 / st.V, st.T);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var r = velAndLoss(inp.pipeInDiam, inp.stmFlow, st.V, eta, inp.pipeLen, inp.fittings, eps);
    return { stmVelo: r.v, pressLoss: r.dp, equivLen: r.leq };
  };

  /*
   * 11120 — Подбор размера трубы по допустимой скорости пара.
   * Вход: pipeGrade(idx), stmPress, stmTemp, stmFlow, upperVelo(м/с), pipeLen, fittings, pipeRough.
   * Выход: pipeSize, pipeInDiam(м), stmVelo, pressLoss(Па), equivLen(м), exceeded.
   */
  CALC['11120'] = function (inp) {
    var S = steam(), PIPES = pipes();
    var st = steamState(inp.stmPress, inp.stmTemp), V = st.V;
    var eta = S.viscosity(1 / V, st.T);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var list = PIPES[inp.pipeGrade] || PIPES[7];
    var chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000;
      var r = velAndLoss(d, inp.stmFlow, V, eta, inp.pipeLen, inp.fittings, eps);
      if (r.v <= inp.upperVelo) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { // даже наибольшая труба не укладывается в допустимую скорость
      var last = list[list.length - 1], dd = last.id / 1000;
      chosen = { pipe: last, d: dd, r: velAndLoss(dd, inp.stmFlow, V, eta, inp.pipeLen, inp.fittings, eps) };
      exceeded = true;
    }
    return {
      pipeSize: formatSize(inp.pipeGrade, chosen.pipe),
      pipeInDiam: chosen.d, stmVelo: chosen.r.v, pressLoss: chosen.r.dp,
      equivLen: chosen.r.leq, exceeded: exceeded
    };
  };

  // ----- Клапаны и сопла (методика IEC 60534 для сжимаемого потока) -----
  // FXT = Fγ·xT — откалибровано по TLV (Fγ≈1.010, xT=0.72). Расход в кг/ч при p в кПа, ρ в кг/м³.
  var FXT = 0.7275;
  // Массовый расход пара (кг/ч) через клапан с пропускной способностью Cv(US).
  function valveSteamFlow(Cv, p1kPa, p2kPa, rho) {
    var dp = p1kPa - p2kPa; if (dp < 0) dp = 0;
    var x = dp / p1kPa;
    if (x < FXT) return 2.73 * Cv * (1 - x / (3 * FXT)) * Math.sqrt(dp * rho); // докритический
    return (2 / 3) * 2.73 * Cv * Math.sqrt(FXT * p1kPa * rho);                 // запертый поток
  }
  function steamDensity(Pabs, Tk) { return 1 / steamState(Pabs, Tk).V; }

  /*
   * 11210 — Расход пара через клапан по Cv.
   * Вход: stmPrimPress(МПа абс), stmSecondPress(МПа абс), cvValue(Cv US), stmTemp(К|null). Выход: stmFlow(кг/ч).
   */
  CALC['11210'] = function (inp) {
    var rho = steamDensity(inp.stmPrimPress, inp.stmTemp);
    return { stmFlow: valveSteamFlow(inp.cvValue, inp.stmPrimPress * 1000, inp.stmSecondPress * 1000, rho) };
  };

  /*
   * 11220 — Пропускная способность Cv по расходу пара (обратная 11210; расход линеен по Cv).
   * Вход: stmPrimPress, stmSecondPress, stmFlow(кг/ч), stmTemp. Выход: cvValue(Cv US).
   */
  CALC['11220'] = function (inp) {
    var rho = steamDensity(inp.stmPrimPress, inp.stmTemp);
    var per = valveSteamFlow(1, inp.stmPrimPress * 1000, inp.stmSecondPress * 1000, rho);
    return { cvValue: per > 0 ? inp.stmFlow / per : NaN };
  };

  /*
   * 11230 — Расход пара через сопло/орифис. Эквивалент Cv = C·(do/4.654)², do в мм.
   * Вход: stmPrimPress, stmSecondPress, orificeDiam(м), dischargeCoeff(C), stmTemp. Выход: stmFlow(кг/ч).
   */
  CALC['11230'] = function (inp) {
    var rho = steamDensity(inp.stmPrimPress, inp.stmTemp);
    var doMm = inp.orificeDiam * 1000;
    var C = (inp.dischargeCoeff != null && !isNaN(inp.dischargeCoeff)) ? inp.dischargeCoeff : 0.70; // дефолт TLV
    var CvEq = C * Math.pow(doMm / 4.654, 2);
    return { stmFlow: valveSteamFlow(CvEq, inp.stmPrimPress * 1000, inp.stmSecondPress * 1000, rho) };
  };

  // ----- Расход конденсата -----
  // ΔH — теплота, отдаваемая паром конденсату (кДж/кг): энтальпия пара минус насыщенной воды при Ps.
  function enthDiff(Pabs, Tk) {
    var S = steam(), Ts = S.Tsat(Pabs), hf = S.satLiquid(Pabs).h;
    var hg = (Tk && Tk > Ts + 0.1) ? S.superheated(Pabs, Tk).h : S.satVapor(Pabs).h;
    return hg - hf;
  }

  /*
   * 11330 — Расход конденсата при непрерывном нагреве жидкости.
   * Вход: gravity(SG), specHeat(кДж/кг·К), lqdFlow(м³/ч), lqdInTemp(К), lqdOutTemp(К), stmPress(МПа), stmTemp(К).
   * Выход: condLoad(кг/ч).
   */
  CALC['11330'] = function (inp) {
    var dH = enthDiff(inp.stmPress, inp.stmTemp);
    return { condLoad: inp.specHeat * inp.gravity * inp.lqdFlow * (inp.lqdOutTemp - inp.lqdInTemp) / dH * 1000 };
  };

  /*
   * 11331 — Конденсат при периодическом нагреве жидкости (фиксированный объём за время).
   * Вход: ..., lqdAmount(м³), heatTime(ч). Выход: totalAmount(кг), aveAmount(кг/ч).
   */
  CALC['11331'] = function (inp) {
    var dH = enthDiff(inp.stmPress, inp.stmTemp);
    var total = inp.specHeat * inp.gravity * inp.lqdAmount * (inp.lqdOutTemp - inp.lqdInTemp) / dH * 1000;
    return { totalAmount: total, aveAmount: inp.heatTime > 0 ? total / inp.heatTime : NaN };
  };

  /*
   * 11340 — Расход конденсата при нагреве воздуха (давление атмосферное).
   * ca·γa — теплоёмкость·плотность воздуха (откалибровано по TLV). Qa в м³/ч (после конверсии из м³/мин).
   * Вход: stmPress, stmTemp, airFlow(м³/ч), airInTemp(К), airOutTemp(К). Выход: condLoad(кг/ч).
   */
  var AIR_CA_GAMMA = 1.209; // ca·γa, кДж/(м³·К) — калибровка по TLV (ca≈1.005, γa≈1.203 при 20°C)
  CALC['11340'] = function (inp) {
    var dH = enthDiff(inp.stmPress, inp.stmTemp);
    return { condLoad: AIR_CA_GAMMA * inp.airFlow * (inp.airOutTemp - inp.airInTemp) / dH };
  };

  /*
   * 12310 — Образование выпара (flash steam) при дросселировании конденсата.
   * Вход: condPress(МПа абс), condFlow(кг/ч), recoveryPress(МПа абс). Выход: flashRatio(%), flashFlow(кг/ч).
   */
  CALC['12310'] = function (inp) {
    var S = steam();
    var hw = S.satLiquid(inp.condPress).h;       // энтальпия насыщ. воды при давлении конденсата
    var hc = S.satLiquid(inp.recoveryPress).h;   // при давлении вторичного пара
    var hfg = S.latentHeat(inp.recoveryPress);
    var Rfs = (hw - hc) / hfg * 100;
    return { flashRatio: Rfs, flashFlow: Rfs / 100 * inp.condFlow };
  };

  /*
   * 11510 — Свойства насыщенного пара по давлению. Вход: stmPress(МПа абс).
   * Выход (СИ): satTemp(К), latentHeat(кДж/кг), satVapEnth(кДж/кг), satWtrEnth(кДж/кг),
   *             satVapVol(м³/кг), satWtrVol(м³/кг).
   */
  CALC['11510'] = function (inp) {
    var S = steam(), P = inp.stmPress;
    return {
      satTemp: S.Tsat(P), latentHeat: S.latentHeat(P),
      satVapEnth: S.satVapor(P).h, satWtrEnth: S.satLiquid(P).h,
      satVapVol: S.satVapor(P).v, satWtrVol: S.satLiquid(P).v
    };
  };

  /*
   * 11520 — Свойства насыщенного пара по температуре. Вход: stmTemp(К).
   * Выход: stmPress(МПа абс), latentHeat, satVapEnth, satWtrEnth, satVapVol, satWtrVol.
   */
  CALC['11520'] = function (inp) {
    var S = steam(), P = S.Psat(inp.stmTemp);
    return {
      stmPress: P, latentHeat: S.latentHeat(P),
      satVapEnth: S.satVapor(P).h, satWtrEnth: S.satLiquid(P).h,
      satVapVol: S.satVapor(P).v, satWtrVol: S.satLiquid(P).v
    };
  };

  /*
   * 11530 — Свойства перегретого пара. Вход: stmPress(МПа абс), stmTemp(К).
   * Выход: superEnth(кДж/кг), superVol(м³/кг), superCp(кДж/кг·К), superVisc(мПа·с).
   */
  CALC['11530'] = function (inp) {
    var S = steam(), st = S.superheated(inp.stmPress, inp.stmTemp);
    return {
      superEnth: st.h, superVol: st.v, superCp: S.cpSuperheated(inp.stmPress, inp.stmTemp),
      superVisc: S.viscosity(1 / st.v, inp.stmTemp) * 1000 // Па·с -> мПа·с
    };
  };

  // ----- Теплопотери через изоляцию (11320) -----
  // Коэффициент теплоотдачи с поверхности α(W/м²·К) от скорости ветра (калибровка по TLV).
  function alphaSurface(v) { return 13.06 + 5.954 * Math.pow(v < 0 ? 0 : v, 0.6); }
  // Теплопроводность изоляции λ(W/м·К) = λ0 + k·Tmean(°C). Калибровка по TLV (значения JIS).
  // Индекс = value селекта изоляции: 0 минвата Rockwool, 1 стекловата, 2 силикат кальция, 3 перлит.
  var INS_LAMBDA = [
    { l0: 0.03541, k: 1.325e-4 }, // Rockwool
    { l0: 0.02854, k: 1.846e-4 }, // стекловата
    { l0: 0.04085, k: 1.217e-4 }, // силикат кальция
    { l0: 0.06313, k: 1.227e-4 }  // перлит
  ];

  /*
   * 11320 — Теплопотери через изолированную трубу (насыщенный пар).
   * Вход: pipeOutDiam(d1,м), insType(idx), stmPress(МПа абс), windVelo(м/с),
   *       insThick(L,м), pipeLen(l,м), ambTemp(К). Выход: condLoad(кг/ч), radiantHeat(Вт, всего).
   */
  CALC['11320'] = function (inp) {
    var S = steam();
    var Ts = S.Tsat(inp.stmPress) - 273.15;          // °C
    var Tam = inp.ambTemp - 273.15;                   // °C
    var dH = S.latentHeat(inp.stmPress);
    var d1 = inp.pipeOutDiam, L = inp.insThick, D = d1 + 2 * L;
    var lnR = Math.log(D / d1);
    var alpha = alphaSurface(inp.windVelo);
    var ins = INS_LAMBDA[inp.insType] || INS_LAMBDA[0];
    var Tmean = Ts, Qr = 0;
    for (var i = 0; i < 12; i++) {                    // итерация λ↔Tmean
      var lam = ins.l0 + ins.k * Tmean;
      Qr = 2 * Math.PI * (Ts - Tam) / (lnR / lam + 2 / (D * alpha)); // Вт/м
      var Tsurf = Tam + Qr / (Math.PI * D * alpha);
      Tmean = (Ts + Tsurf) / 2;
    }
    var mc = 3.6 * Qr / dH * inp.pipeLen;             // кг/ч
    return { condLoad: mc, radiantHeat: Qr * inp.pipeLen }; // тепло — всего (Вт)
  };

  /*
   * 11310 — Расход конденсата на прогрев трубопровода при запуске (насыщенный пар).
   * mh = cp·Wp·l·(Ts-Tam)/ΔH  (теплоёмкость металла трубы),
   * mr — лучистые потери за время прогрева tSU при средней температуре прогрева (Ts+100)/2.
   * Вход: pipeOutDiam(d1,м), pipeInDiam(м), insType(idx), stmPress(МПа абс), stmTemp(К|null),
   *       windVelo(м/с), insThick(L,м), pipeLen(l,м), ambTemp(К), startTime(ч). Калибровано по TLV.
   * Выход: condHeatPipe(mh,кг), condRadiant(mr,кг), condTotal(mc,кг).
   */
  var CP_STEEL = 0.51, RHO_STEEL = 7850; // кДж/кг·К, кг/м³ (калибровка по TLV)
  CALC['11310'] = function (inp) {
    var S = steam();
    var Ts = S.Tsat(inp.stmPress) - 273.15, Tam = inp.ambTemp - 273.15;
    var dH = enthDiff(inp.stmPress, inp.stmTemp);
    var d1 = inp.pipeOutDiam, ID = inp.pipeInDiam, L = inp.insThick, D = d1 + 2 * L;
    // Конденсат на прогрев металла трубы
    var Wp = Math.PI / 4 * (d1 * d1 - ID * ID) * RHO_STEEL; // кг/м
    var mh = CP_STEEL * Wp * inp.pipeLen * (Ts - Tam) / dH;
    // Конденсат от лучистых потерь за время прогрева (λ при средней темп. прогрева)
    var Tw = (Ts + 100) / 2, alpha = alphaSurface(inp.windVelo);
    var ins = INS_LAMBDA[inp.insType] || INS_LAMBDA[0];
    var lnR = Math.log(D / d1), Tmean = Tw, Qrw = 0;
    for (var i = 0; i < 12; i++) {
      var lam = ins.l0 + ins.k * Tmean;
      Qrw = 2 * Math.PI * (Tw - Tam) / (lnR / lam + 2 / (D * alpha));
      Tmean = (Tw + (Tam + Qrw / (Math.PI * D * alpha))) / 2;
    }
    var mr = 3.6 * Qrw * inp.pipeLen * inp.startTime / dH; // startTime в часах
    return { condHeatPipe: mh, condRadiant: mr, condTotal: mh + mr };
  };

  /*
   * 11130 — Подбор размера трубы по скорости (упрощённый: без фитингов).
   * Вход: pipeGrade, stmPress, stmTemp, stmFlow, upperVelo(м/с), pipeLen, pipeRough. Выход: pipeSize, pipeInDiam, stmVelo, pressLoss.
   */
  CALC['11130'] = function (inp) {
    var S = steam(), PIPES = pipes();
    var st = steamState(inp.stmPress, inp.stmTemp), V = st.V, eta = S.viscosity(1 / V, st.T);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000;
      var r = velAndLoss(d, inp.stmFlow, V, eta, inp.pipeLen, {}, eps);
      if (r.v <= inp.upperVelo) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000; chosen = { pipe: last, d: dd, r: velAndLoss(dd, inp.stmFlow, V, eta, inp.pipeLen, {}, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, stmVelo: chosen.r.v, pressLoss: chosen.r.dp, exceeded: exceeded };
  };

  /*
   * 11350 / 11360 — Точка подтопления (stall point) для теплообменника.
   * S = (Tb − Tm)/(Ts − Tm)·100, где Tm=(T1+T2)/2 — средняя темп. среды, Tb — темп. насыщения
   * при противодавлении. Вход: lqdInTemp/airInTemp(T1,К), lqdOutTemp/airOutTemp(T2,К),
   * stmPress(МПа), stmTemp(К|null), backPress(МПа), oversur(%). Выход: stallPoint(%), stallPointOs(%).
   */
  function stallPoint(inp) {
    var S = steam();
    var Ts = (inp.stmTemp && inp.stmTemp > S.Tsat(inp.stmPress) ? inp.stmTemp : S.Tsat(inp.stmPress)) - 273.15;
    var Tb = S.Tsat(inp.backPress) - 273.15;
    var T1 = inp.t1 - 273.15, T2 = inp.t2 - 273.15, Tm = (T1 + T2) / 2;
    var Sp = (Tb - Tm) / (Ts - Tm) * 100;
    var os = inp.oversur || 0;
    return { stallPoint: Sp, stallPointOs: Sp * (1 + os / 100) }; // Os — с запасом поверхности (предв., калибровать)
  }
  CALC['11350'] = function (inp) { return stallPoint({ t1: inp.lqdInTemp, t2: inp.lqdOutTemp, stmPress: inp.stmPress, stmTemp: inp.stmTemp, backPress: inp.backPress, oversur: inp.oversur }); };
  CALC['11360'] = function (inp) { return stallPoint({ t1: inp.airInTemp, t2: inp.airOutTemp, stmPress: inp.stmPress, stmTemp: inp.stmTemp, backPress: inp.backPress, oversur: inp.oversur }); };

  // ===== ВОДА: гидравлика трубопроводов (13110–13150) =====
  // Температура воды по умолчанию (нет ввода на этих страницах) — калибровать по TLV.
  var WATER_T = 293.15; // 20 °C
  function waterProps(Pabs) { var V = waterV(Pabs, WATER_T); return { V: V, eta: waterVisc(WATER_T) }; }

  // 13110 — подбор трубы по допустимым потерям (вода). Qw в м³/ч, pw в МПа абс.
  CALC['13110'] = function (inp) {
    var PIPES = pipes(), wp = waterProps(inp.wtrPress), eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var Qs = inp.wtrFlow / 3600, list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000, v = Qs / pipeArea(d);
      var r = hydraulics(d, v, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps);
      if (r.dp <= inp.allowPressLoss) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000, vv = Qs / pipeArea(dd); chosen = { pipe: last, d: dd, r: hydraulics(dd, vv, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, wtrVelo: chosen.r.v, pressLoss: chosen.r.dp, equivLen: chosen.r.leq, exceeded: exceeded };
  };

  // 13120 — подбор трубы по скорости (вода).
  CALC['13120'] = function (inp) {
    var PIPES = pipes(), wp = waterProps(inp.wtrPress || 0.101325), eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var Qs = inp.wtrFlow / 3600, list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000, v = Qs / pipeArea(d);
      if (v <= inp.upperVelo) { chosen = { pipe: list[i], d: d, r: hydraulics(d, v, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps) }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000, vv = Qs / pipeArea(dd); chosen = { pipe: last, d: dd, r: hydraulics(dd, vv, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, wtrVelo: chosen.r.v, pressLoss: chosen.r.dp, equivLen: chosen.r.leq, exceeded: exceeded };
  };

  // 13130 — потери давления и скорость в заданной трубе (вода).
  CALC['13130'] = function (inp) {
    var wp = waterProps(inp.wtrPress || 0.101325), eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var v = inp.wtrFlow / 3600 / pipeArea(inp.pipeInDiam);
    var r = hydraulics(inp.pipeInDiam, v, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps);
    return { wtrVelo: r.v, pressLoss: r.dp, equivLen: r.leq };
  };

  // 13140 — скорость воды в трубе. 13150 — расход воды по скорости.
  CALC['13140'] = function (inp) { return { wtrVelo: inp.wtrFlow / 3600 / pipeArea(inp.pipeInDiam) }; };
  CALC['13150'] = function (inp) { return { wtrFlowRate: inp.wtrVelo * pipeArea(inp.pipeInDiam) * 3600 }; };

  // Подпись типоразмера: для DIN -> "DN80", иначе метрический размер.
  function formatSize(gradeIdx, pipe) {
    if (gradeIdx === 7) return 'DN' + parseInt(pipe.m, 10);
    return pipe.m;
  }

  if (typeof window !== 'undefined') { window.CALC = CALC; window.CALC_helpers = { colebrook: colebrook, velAndLoss: velAndLoss, steamState: steamState }; }
  if (typeof module !== 'undefined' && module.exports) module.exports = { CALC: CALC, colebrook: colebrook, velAndLoss: velAndLoss, steamState: steamState };
})();
