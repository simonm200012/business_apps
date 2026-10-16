/* Service jobs demo data (Business Apps). Every company, person, address, phone number and amount here is fictional.
 * generate(today, { now: 'HH:MM' }) builds Termoplan Savinja d.o.o., an installer around Celje that services heat pumps,
 * gas boilers, air conditioners, ventilation units and solar systems: 7 busy technicians (3–4 visits a working day),
 * about 3,200 customers and 4,800 pieces of equipment, about 4,700 jobs over the last 9 months (annual services peak
 * before the heating season and before summer, repairs follow the weather), today's board with one technician on site
 * and one on the road and a few free windows, the next four working days partly planned, a queue of new jobs and a few
 * jobs waiting for parts. Parts come from Nordvik Distribucija. `now` is the demo clock, clamped to 10:40–15:50 so
 * today's jobs are mid-day. Same inputs, same data. pack()/unpack() turn the data into the compact form the app stores.
 * UMD for Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.ServiceData = factory(root.ServiceEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  var VERSION = 2;
  var N_CUSTOMERS = 3000;
  var HISTORY_DAYS = 273; // about 9 months

  // ── random numbers ───────────────────────────────────────────────────────
  function rng(seed) {
    var a = seed >>> 0;
    var f = function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.between = function (lo, hi) { return lo + (hi - lo) * f(); };
    f.int = function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * f()); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length)]; };
    f.chance = function (p) { return f() < p; };
    return f;
  }
  function hashStr(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  function shuffle(a, r) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pickW(list, r) {
    var tot = 0, i; for (i = 0; i < list.length; i++) tot += list[i][1];
    var x = r() * tot; for (i = 0; i < list.length; i++) { x -= list[i][1]; if (x < 0) return list[i][0]; }
    return list[list.length - 1][0];
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function ascii(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }

  // ── company and people ───────────────────────────────────────────────────
  // phone numbers: +386 1 000 … / +385 1 000 … are not given to subscribers, so a tap on a demo number never rings anyone.
  // The IBAN has the check digits 00, so no bank accepts a payment to it.
  var COMPANY = { name: 'Termoplan Savinja d.o.o.', street: 'Opekarniška cesta 15', postal: '3000', city: 'Celje', phone: '+386 1 000 61 20', email: 'servis.termoplan@example.com', vatId: '',
    iban: 'SI00 1010 0001 2345 678', bic: '',
    about: 'Installs and services heat pumps, gas condensing boilers, air conditioning and ventilation with heat recovery around Celje. Buys its parts from Nordvik Distribucija d.o.o.' };
  var OFFICE = { name: 'Petra Golob', role: 'Dispatcher' };
  var FOOTER = {
    sl: 'Hvala za zaupanje. Poročilo shranite za morebitne garancijske zahtevke.',
    hr: 'Hvala na povjerenju. Izvješće sačuvajte za moguće jamstvene zahtjeve.',
    en: 'Thank you for your trust. Keep this report for any warranty claims.'
  };
  // id, name, skills, home base, colour, phone
  var TECHS = [
    ['t1', 'Matej Kovačič', ['gas', 'hp', 'el'], 'Celje', 'c1', '+386 1 000 51 23'],
    ['t2', 'Ana Zupan', ['hp', 'ac', 'el'], 'Celje', 'c2', '+386 1 000 52 89'],
    ['t3', 'Rok Hribar', ['ac', 'vent', 'el'], 'Žalec', 'c3', '+386 1 000 53 64'],
    ['t4', 'Tomislav Babić', ['gas', 'hp'], 'Velenje', 'c4', '+386 1 000 54 37'],
    ['t5', 'Gregor Podgoršek', ['hp', 'vent', 'gas'], 'Velenje', 'c5', '+386 1 000 55 90'],
    ['t6', 'Nejc Krajnc', ['ac', 'el', 'vent'], 'Žalec', 'c6', '+386 1 000 56 21'],
    ['t7', 'Luka Ramšak', ['gas', 'hp'], 'Celje', 'c7', '+386 1 000 57 75']
  ];

  /** what earlier versions of the generator put in: real-looking numbers the app replaces once in stored demo data */
  var OLD_PHONES = { company: '+386 3 428 61 20', techs: { t1: '+386 41 512 330', t2: '+386 40 288 914', t3: '+386 31 640 275', t4: '+386 51 377 102', t5: '+386 41 905 467', t6: '+386 70 214 389', t7: '+386 68 133 751' },
    customer: /^\+386 (?:(?:30|31|40|41|51|64|68|70|71) \d{3} \d{3}|3 \d{3} \d{2} \d{2})$/ };
  /** a safe stand-in for an old demo number, made from its last digits so the same number always gets the same one */
  function safePhone(old, cc) { var d = String(old || '').replace(/\D/g, ''); d = ('0000' + d).slice(-4); return '+' + (cc || '386') + ' 1 000 ' + d.slice(0, 2) + ' ' + d.slice(2); }

  // ── parts catalogue (net prices in EUR; vanStd = what a van carries, vanMin = reorder below) ──
  var PARTS = [
    ['GB-ELC-01', 'Ignition electrode', 'Vžigalna elektroda', 'Elektroda za paljenje', 24.6, 'pc', 'gas', 2, 1],
    ['GB-ION-01', 'Ionisation electrode', 'Ionizacijska elektroda', 'Ionizacijska elektroda', 21.3, 'pc', 'gas', 2, 1],
    ['GB-GSK-01', 'Burner door gasket', 'Tesnilo vrat gorilnika', 'Brtva vrata plamenika', 18.4, 'pc', 'gas', 3, 1],
    ['GB-SIF-01', 'Condensate siphon', 'Sifon za kondenz', 'Sifon kondenzata', 32.1, 'pc', 'gas', 1, 1],
    ['GB-FAN-01', 'Burner fan', 'Ventilator gorilnika', 'Ventilator plamenika', 286, 'pc', 'gas', 0, 0],
    ['GB-GV-01', 'Gas valve', 'Plinski ventil', 'Plinski ventil', 312, 'pc', 'gas', 0, 0],
    ['GB-PCB-01', 'Boiler control board', 'Krmilna elektronika kotla', 'Upravljačka elektronika kotla', 398, 'pc', 'gas', 0, 0],
    ['GB-NTC-01', 'NTC temperature sensor', 'NTC tipalo temperature', 'NTC osjetnik temperature', 19.8, 'pc', 'gas', 2, 1],
    ['GB-PMP-01', 'Circulation pump', 'Obtočna črpalka', 'Cirkulacijska pumpa', 214, 'pc', 'gas', 0, 0],
    ['GB-PRS-01', 'Water pressure sensor', 'Tipalo tlaka vode', 'Osjetnik tlaka vode', 44.5, 'pc', 'gas', 1, 1],
    ['GB-3WV-01', 'Diverter valve motor', 'Pogon preklopnega ventila', 'Motor preklopnog ventila', 96, 'pc', 'gas', 1, 0],
    ['GB-EXP-08', 'Expansion vessel 8 l', 'Raztezna posoda 8 l', 'Ekspanzijska posuda 8 l', 58, 'pc', 'gas', 0, 0],
    ['GB-FLG-60', 'Flue gasket 60/100', 'Tesnilo dimovoda 60/100', 'Brtva dimovoda 60/100', 9.8, 'pc', 'gas', 3, 1],
    ['GB-NEU-01', 'Condensate neutraliser refill', 'Polnilo nevtralizatorja kondenza', 'Punjenje neutralizatora kondenzata', 27, 'pc', 'gas', 1, 0],
    ['HP-MAG-01', 'Magnetic filter cartridge', 'Vložek magnetnega filtra', 'Uložak magnetskog filtra', 29.9, 'pc', 'hp', 2, 1],
    ['HP-EEV-01', 'Expansion valve coil', 'Tuljava ekspanzijskega ventila', 'Zavojnica ekspanzijskog ventila', 118, 'pc', 'hp', 0, 0],
    ['HP-OAT-01', 'Outdoor temperature sensor', 'Zunanje temperaturno tipalo', 'Vanjski osjetnik temperature', 22.4, 'pc', 'hp', 2, 1],
    ['HP-FAN-01', 'Outdoor unit fan motor', 'Motor ventilatorja zunanje enote', 'Motor ventilatora vanjske jedinice', 264, 'pc', 'hp', 0, 0],
    ['HP-INV-01', 'Inverter board', 'Inverterska plošča', 'Inverterska pločica', 642, 'pc', 'hp', 0, 0],
    ['HP-FLS-01', 'Flow switch', 'Pretočno stikalo', 'Sklopka protoka', 58.7, 'pc', 'hp', 1, 0],
    ['HP-SV3-01', 'Safety valve 3 bar', 'Varnostni ventil 3 bar', 'Sigurnosni ventil 3 bar', 17.6, 'pc', 'hp', 2, 1],
    ['HP-EXP-18', 'Expansion vessel 18 l', 'Raztezna posoda 18 l', 'Ekspanzijska posuda 18 l', 74, 'pc', 'hp', 0, 0],
    ['HP-AAV-01', 'Automatic air vent', 'Avtomatski odzračevalnik', 'Automatski odzračni ventil', 12.4, 'pc', 'hp', 3, 1],
    ['HP-ANO-01', 'Magnesium anode 33 × 400', 'Magnezijeva anoda 33 × 400', 'Magnezijska anoda 33 × 400', 34.8, 'pc', 'hp', 1, 0],
    ['HP-HTR-03', 'Backup heater 3 kW', 'Električni grelnik 3 kW', 'Električni grijač 3 kW', 132, 'pc', 'hp', 0, 0],
    ['HP-CTL-01', 'Room controller', 'Sobni regulator', 'Sobni regulator', 156, 'pc', 'hp', 0, 0],
    ['AC-FLT-01', 'Indoor unit filter set', 'Komplet filtrov notranje enote', 'Komplet filtera unutarnje jedinice', 14.9, 'pc', 'ac', 3, 1],
    ['AC-CAP-01', 'Fan capacitor', 'Kondenzator ventilatorja', 'Kondenzator ventilatora', 16.2, 'pc', 'ac', 2, 1],
    ['AC-PMP-01', 'Condensate pump', 'Črpalka za kondenz', 'Pumpa kondenzata', 68.5, 'pc', 'ac', 1, 0],
    ['AC-RMT-01', 'Remote control', 'Daljinski upravljalnik', 'Daljinski upravljač', 32, 'pc', 'ac', 1, 0],
    ['AC-SNS-01', 'Coil temperature sensor', 'Tipalo temperature uparjalnika', 'Osjetnik temperature isparivača', 18.9, 'pc', 'ac', 2, 1],
    ['AC-PCB-01', 'Indoor unit control board', 'Elektronika notranje enote', 'Elektronika unutarnje jedinice', 174, 'pc', 'ac', 0, 0],
    ['AC-FMO-01', 'Air conditioner outdoor fan motor', 'Motor ventilatorja zunanje enote klimatske naprave', 'Motor ventilatora vanjske jedinice klima-uređaja', 148, 'pc', 'ac', 0, 0],
    ['RF-R32', 'Refrigerant R32', 'Hladivo R32', 'Rashladno sredstvo R32', 46, 'kg', 'ac,hp', 2, 1],
    ['RF-R410A', 'Refrigerant R410A', 'Hladivo R410A', 'Rashladno sredstvo R410A', 72, 'kg', 'ac', 1, 0],
    ['RF-R290', 'Refrigerant R290', 'Hladivo R290', 'Rashladno sredstvo R290', 58, 'kg', 'hp', 0, 0],
    ['VT-FLT-300', 'Filter set Recu 300 (G4/F7)', 'Komplet filtrov Recu 300 (G4/F7)', 'Komplet filtera Recu 300 (G4/F7)', 38.5, 'pc', 'vent', 2, 1],
    ['VT-FLT-450', 'Filter set Recu 450 (G4/F7)', 'Komplet filtrov Recu 450 (G4/F7)', 'Komplet filtera Recu 450 (G4/F7)', 44.9, 'pc', 'vent', 2, 1],
    ['VT-FLT-350', 'Filter set AirX 350 (G4/F7)', 'Komplet filtrov AirX 350 (G4/F7)', 'Komplet filtera AirX 350 (G4/F7)', 41.2, 'pc', 'vent', 1, 1],
    ['VT-FAN-01', 'EC fan', 'EC ventilator', 'EC ventilator', 238, 'pc', 'vent', 0, 0],
    ['VT-BYP-01', 'Bypass actuator', 'Pogon obvoda', 'Pogon obilaznice', 84, 'pc', 'vent', 0, 0],
    ['VT-HUM-01', 'Humidity sensor', 'Tipalo vlage', 'Osjetnik vlage', 46, 'pc', 'vent', 1, 0],
    ['VT-CTL-01', 'Ventilation control panel', 'Upravljalna plošča prezračevanja', 'Upravljačka ploča ventilacije', 112, 'pc', 'vent', 0, 0],
    ['SL-FLD-10', 'Solar fluid 10 l', 'Solarna tekočina 10 l', 'Solarna tekućina 10 l', 54, 'pc', 'solar', 1, 0],
    ['SL-PST-01', 'Solar pump station', 'Solarna črpalna postaja', 'Solarna crpna stanica', 386, 'pc', 'solar', 0, 0],
    ['SL-CTL-01', 'Solar controller', 'Solarni regulator', 'Solarni regulator', 168, 'pc', 'solar', 0, 0],
    ['SL-PT1-01', 'Collector sensor PT1000', 'Tipalo kolektorja PT1000', 'Osjetnik kolektora PT1000', 21, 'pc', 'solar', 1, 0],
    ['GN-INH-01', 'Inhibitor 1 l', 'Inhibitor 1 l', 'Inhibitor 1 l', 19.5, 'pc', 'gas,hp,solar', 3, 1],
    ['GN-CLN-01', 'Coil cleaner 1 l', 'Čistilo za lamele 1 l', 'Sredstvo za čišćenje lamela 1 l', 11.9, 'pc', 'ac,hp', 3, 1],
    ['GN-DIS-01', 'Disinfectant spray', 'Dezinfekcijsko pršilo', 'Dezinfekcijski sprej', 8.4, 'pc', 'ac,vent', 4, 2],
    ['GN-SEA-01', 'Seal and gasket set', 'Komplet tesnil', 'Komplet brtvi', 6.8, 'pc', '', 5, 2],
    ['GN-CU14', 'Copper pipe 1/4"', 'Bakrena cev 1/4"', 'Bakrena cijev 1/4"', 6.4, 'm', 'ac,hp', 10, 4],
    ['GN-CU38', 'Copper pipe 3/8"', 'Bakrena cev 3/8"', 'Bakrena cijev 3/8"', 8.9, 'm', 'ac,hp', 10, 4],
    ['GN-INS-01', 'Pipe insulation', 'Izolacija cevi', 'Izolacija cijevi', 2.6, 'm', '', 10, 4],
    ['GN-CBL-01', 'Cable 3 × 2.5 mm²', 'Kabel 3 × 2,5 mm²', 'Kabel 3 × 2,5 mm²', 1.9, 'm', '', 15, 5],
    ['GN-FIT-01', 'Fittings set', 'Komplet fitingov', 'Komplet fitinga', 14.5, 'pc', '', 3, 1],
    ['GN-BLV-34', 'Ball valve 3/4"', 'Krogelni ventil 3/4"', 'Kuglasti ventil 3/4"', 12.8, 'pc', 'gas,hp,solar', 3, 1],
    ['GN-GAU-01', 'Pressure gauge', 'Manometer', 'Manometar', 9.6, 'pc', 'gas,hp,solar', 2, 1],
    ['GN-HOS-50', 'Flexible hose 50 cm', 'Gibljiva cev 50 cm', 'Fleksibilno crijevo 50 cm', 7.3, 'pc', 'gas,hp', 4, 1],
    ['GN-BRK-01', 'Outdoor unit wall bracket set', 'Konzola za zunanjo enoto', 'Konzola za vanjsku jedinicu', 48, 'pc', 'ac,hp', 1, 0],
    ['GN-DMP-01', 'Anti-vibration pads', 'Protivibracijske podloge', 'Antivibracijski podlošci', 16, 'pc', 'ac,hp', 2, 1],
    ['GN-BAT-01', 'Batteries AAA, 2 pcs', 'Baterije AAA, 2 kosa', 'Baterije AAA, 2 kom.', 2.4, 'pc', 'ac', 6, 2],
    ['GN-COD-01', 'CO detector', 'Detektor CO', 'Detektor CO', 39, 'pc', 'gas', 1, 0],
    ['GN-CDH-01', 'Condensate hose', 'Cev za kondenz', 'Crijevo za kondenzat', 1.8, 'm', 'ac,vent,gas', 10, 3]
  ].map(function (p) { return { id: p[0], code: p[0], name: p[1], sl: p[2], hr: p[3], price: p[4], unit: p[5], kinds: p[6] ? p[6].split(',') : [], vanStd: p[7], vanMin: p[8] }; });

  // ── checklist items (English, Slovene, Croatian) and templates per job type and equipment ──
  // id: [en, sl, hr, type pf|num|choice, unit, required, typical low, typical high, options]
  var ITEMS = {
    visual: ['Visual inspection', 'Vizualni pregled', 'Vizualni pregled', 'pf', '', 1],
    func: ['Function test', 'Preizkus delovanja', 'Ispitivanje rada', 'pf', '', 1],
    inform: ['Customer informed about the work', 'Naročnik seznanjen z opravljenim delom', 'Naručitelj upoznat s izvršenim radovima', 'pf', '', 0],
    clean: ['Work area left clean', 'Delovno mesto pospravljeno', 'Radno mjesto pospremljeno', 'pf', '', 0],
    g_burner: ['Burner and heat exchanger cleaned', 'Gorilnik in toplotni izmenjevalnik očiščena', 'Plamenik i izmjenjivač topline očišćeni', 'pf', '', 1],
    g_siphon: ['Condensate siphon cleaned', 'Sifon za kondenz očiščen', 'Sifon kondenzata očišćen', 'pf', '', 1],
    g_elec: ['Ignition and ionisation electrodes checked', 'Vžigalna in ionizacijska elektroda pregledani', 'Elektrode za paljenje i ionizaciju provjerene', 'pf', '', 0],
    g_tight: ['Gas tightness test', 'Preizkus tesnosti plinske napeljave', 'Ispitivanje nepropusnosti plinske instalacije', 'pf', '', 1],
    g_flue: ['Flue and air intake checked', 'Dimovod in dovod zraka pregledana', 'Dimovod i dovod zraka pregledani', 'pf', '', 1],
    g_co: ['Flue gas CO', 'CO v dimnih plinih', 'CO u dimnim plinovima', 'num', 'ppm', 1, 0, 100],
    g_co2: ['Flue gas CO₂', 'CO₂ v dimnih plinih', 'CO₂ u dimnim plinovima', 'num', '%', 1, 8, 10.5],
    g_tflue: ['Flue gas temperature', 'Temperatura dimnih plinov', 'Temperatura dimnih plinova', 'num', '°C', 0, 30, 80],
    g_press: ['System water pressure', 'Tlak vode v sistemu', 'Tlak vode u sustavu', 'num', 'bar', 1, 1, 2],
    g_exp: ['Expansion vessel pre-charge', 'Predtlak raztezne posode', 'Predtlak ekspanzijske posude', 'num', 'bar', 0, 0.7, 1.5],
    g_safety: ['Safety valve checked', 'Varnostni ventil preverjen', 'Sigurnosni ventil provjeren', 'pf', '', 0],
    h_coil: ['Outdoor coil and fan cleaned', 'Lamele in ventilator zunanje enote očiščeni', 'Lamele i ventilator vanjske jedinice očišćeni', 'pf', '', 1],
    h_drain: ['Condensate drain clear', 'Odtok kondenza prehoden', 'Odvod kondenzata prohodan', 'pf', '', 1],
    h_leak: ['Refrigerant circuit leak check', 'Preizkus tesnosti hladilnega krogotoka', 'Provjera nepropusnosti rashladnog kruga', 'pf', '', 1],
    h_filter: ['Water filter cleaned', 'Vodni filter očiščen', 'Filtar vode očišćen', 'pf', '', 1],
    h_press: ['System water pressure', 'Tlak vode v sistemu', 'Tlak vode u sustavu', 'num', 'bar', 1, 1, 2.5],
    h_flow: ['Flow temperature', 'Temperatura predtoka', 'Temperatura polaznog voda', 'num', '°C', 1, 25, 55],
    h_ret: ['Return temperature', 'Temperatura povratka', 'Temperatura povratnog voda', 'num', '°C', 1, 20, 50],
    h_hp: ['Refrigerant high pressure', 'Visoki tlak hladiva', 'Visoki tlak rashladnog sredstva', 'num', 'bar', 0, 15, 35],
    h_lp: ['Refrigerant low pressure', 'Nizki tlak hladiva', 'Niski tlak rashladnog sredstva', 'num', 'bar', 0, 4, 12],
    h_elec: ['Electrical connections tightened', 'Električni priključki pritegnjeni', 'Električni priključci pritegnuti', 'pf', '', 0],
    h_log: ['Error log read and settings checked', 'Dnevnik napak in nastavitve pregledani', 'Zapis grešaka i postavke pregledani', 'pf', '', 0],
    h_dhw: ['Hot water tank anode checked', 'Anoda hranilnika tople vode preverjena', 'Anoda spremnika tople vode provjerena', 'pf', '', 0],
    a_filter: ['Indoor filters cleaned', 'Filtri notranje enote očiščeni', 'Filteri unutarnje jedinice očišćeni', 'pf', '', 1],
    a_evap: ['Indoor coil cleaned and disinfected', 'Uparjalnik očiščen in razkužen', 'Isparivač očišćen i dezinficiran', 'pf', '', 1],
    a_cond: ['Outdoor coil cleaned', 'Kondenzator zunanje enote očiščen', 'Kondenzator vanjske jedinice očišćen', 'pf', '', 0],
    a_drain: ['Condensate drain checked', 'Odtok kondenza preverjen', 'Odvod kondenzata provjeren', 'pf', '', 1],
    a_supply: ['Supply air temperature (cooling)', 'Temperatura vpihanega zraka (hlajenje)', 'Temperatura ispuhanog zraka (hlađenje)', 'num', '°C', 1, 6, 16],
    a_room: ['Room air temperature', 'Temperatura zraka v prostoru', 'Temperatura zraka u prostoriji', 'num', '°C', 0, 18, 32],
    a_lp: ['Suction pressure', 'Sesalni tlak', 'Usisni tlak', 'num', 'bar', 0, 7, 11],
    a_leak: ['Leak check', 'Preizkus tesnosti', 'Provjera nepropusnosti', 'pf', '', 1],
    a_remote: ['Remote control and modes tested', 'Daljinski upravljalnik in načini delovanja preizkušeni', 'Daljinski upravljač i načini rada ispitani', 'pf', '', 0],
    v_filter: ['Filter state', 'Stanje filtrov', 'Stanje filtera', 'choice', '', 1, null, null, [['clean', 'Clean', 'Čisti', 'Čisti'], ['replaced', 'Replaced', 'Zamenjani', 'Zamijenjeni'], ['dirty', 'Dirty, not replaced', 'Umazani, niso zamenjani', 'Prljavi, nisu zamijenjeni']]],
    v_hex: ['Heat exchanger cleaned', 'Toplotni izmenjevalnik očiščen', 'Izmjenjivač topline očišćen', 'pf', '', 1],
    v_fans: ['Fans checked', 'Ventilatorji pregledani', 'Ventilatori pregledani', 'pf', '', 1],
    v_drain: ['Condensate drain checked', 'Odtok kondenza preverjen', 'Odvod kondenzata provjeren', 'pf', '', 0],
    v_sup: ['Supply air flow', 'Pretok dovodnega zraka', 'Protok dobavnog zraka', 'num', 'm³/h', 1, 150, 450],
    v_ext: ['Extract air flow', 'Pretok odvodnega zraka', 'Protok odsisnog zraka', 'num', 'm³/h', 0, 150, 450],
    v_bypass: ['Bypass and frost protection tested', 'Obvod in protizmrzovalna zaščita preizkušena', 'Bypass i zaštita od smrzavanja ispitani', 'pf', '', 0],
    o_frost: ['Solar fluid frost protection', 'Protizmrzovalna zaščita solarne tekočine', 'Zaštita solarne tekućine od smrzavanja', 'num', '°C', 1, -40, -20],
    o_ph: ['Solar fluid pH', 'pH solarne tekočine', 'pH solarne tekućine', 'num', 'pH', 0, 7.5, 9],
    o_press: ['Solar circuit pressure', 'Tlak v solarnem krogu', 'Tlak u solarnom krugu', 'num', 'bar', 1, 1.5, 4],
    o_coll: ['Collectors and fixings checked', 'Kolektorji in pritrditve pregledani', 'Kolektori i nosači pregledani', 'pf', '', 1],
    o_pump: ['Pump station and controller checked', 'Črpalna postaja in regulator preverjena', 'Crpna stanica i regulator provjereni', 'pf', '', 1],
    r_fault: ['Fault confirmed on site', 'Napaka potrjena na kraju samem', 'Kvar potvrđen na licu mjesta', 'pf', '', 1],
    r_code: ['Error code read', 'Koda napake odčitana', 'Kod greške očitan', 'pf', '', 0],
    r_cause: ['Cause found', 'Vzrok ugotovljen', 'Uzrok utvrđen', 'pf', '', 1],
    r_fixed: ['Repair carried out', 'Popravilo izvedeno', 'Popravak izvršen', 'pf', '', 1],
    i_deliv: ['Equipment delivered undamaged', 'Oprema dobavljena nepoškodovana', 'Oprema isporučena neoštećena', 'pf', '', 1],
    i_mount: ['Mounted and fixed as per instructions', 'Montirano in pritrjeno po navodilih', 'Montirano i pričvršćeno prema uputama', 'pf', '', 1],
    i_press: ['Heating circuit pressure test', 'Tlačni preizkus ogrevalnega kroga', 'Tlačna proba kruga grijanja', 'num', 'bar', 1, 3, 6],
    i_elec: ['Electrical connection and protection', 'Električna priključitev in zaščita', 'Električni priključak i zaštita', 'pf', '', 1],
    i_flush: ['System flushed and filled', 'Sistem izpran in napolnjen', 'Sustav ispran i napunjen', 'pf', '', 1],
    i_vac: ['Vacuum held for 15 min', 'Vakuum zdržal 15 min', 'Vakuum održan 15 min', 'num', 'mbar', 1, 0, 5],
    i_ref: ['Refrigerant added', 'Dodano hladivo', 'Dodano rashladno sredstvo', 'num', 'kg', 0, 0, 2],
    i_duct: ['Ducts connected and sealed', 'Kanali priključeni in zatesnjeni', 'Kanali spojeni i zabrtvljeni', 'pf', '', 1],
    i_fill: ['Filled with solar fluid and vented', 'Napolnjeno s solarno tekočino in odzračeno', 'Napunjeno solarnom tekućinom i odzračeno', 'pf', '', 1],
    i_doc: ['Manual and warranty card handed over', 'Navodila in garancijski list predani', 'Upute i jamstveni list predani', 'pf', '', 1],
    c_check: ['Installation checked before start-up', 'Inštalacija pregledana pred zagonom', 'Instalacija pregledana prije puštanja u rad', 'pf', '', 1],
    c_set: ['Settings adjusted to the system', 'Parametri nastavljeni glede na sistem', 'Parametri podešeni prema sustavu', 'pf', '', 1],
    c_reg: ['Warranty registered with the manufacturer', 'Garancija registrirana pri proizvajalcu', 'Jamstvo registrirano kod proizvođača', 'pf', '', 1],
    c_train: ['Customer instructed on use', 'Naročnik poučen o uporabi', 'Naručitelj upućen u korištenje', 'pf', '', 1],
    w_label: ['Type plate and serial number checked', 'Napisna ploščica in serijska številka preverjeni', 'Natpisna pločica i serijski broj provjereni', 'pf', '', 1],
    w_log: ['Error log read', 'Dnevnik napak pregledan', 'Zapis grešaka pregledan', 'pf', '', 0],
    w_ok: ['Warranty conditions met', 'Pogoji za garancijo izpolnjeni', 'Uvjeti jamstva ispunjeni', 'pf', '', 1]
  };
  var MEASURE = { gas: ['g_press', 'g_co'], hp: ['h_press', 'h_flow', 'h_ret'], ac: ['a_supply', 'a_lp'], vent: ['v_sup', 'v_ext'], solar: ['o_press', 'o_frost'] };
  var TEMPLATE_IDS = {
    service: {
      gas: ['visual', 'g_burner', 'g_siphon', 'g_elec', 'g_tight', 'g_flue', 'g_co', 'g_co2', 'g_tflue', 'g_press', 'g_exp', 'g_safety', 'func', 'inform'],
      hp: ['visual', 'h_coil', 'h_drain', 'h_leak', 'h_filter', 'h_press', 'h_flow', 'h_ret', 'h_hp', 'h_lp', 'h_elec', 'h_log', 'h_dhw', 'func', 'inform'],
      ac: ['visual', 'a_filter', 'a_evap', 'a_cond', 'a_drain', 'a_leak', 'a_supply', 'a_room', 'a_lp', 'a_remote', 'func', 'inform'],
      vent: ['visual', 'v_filter', 'v_hex', 'v_fans', 'v_drain', 'v_sup', 'v_ext', 'v_bypass', 'func', 'inform'],
      solar: ['visual', 'o_coll', 'o_pump', 'o_frost', 'o_ph', 'o_press', 'func', 'inform']
    },
    repair: function (k) { return ['r_fault', 'r_code', 'r_cause', 'r_fixed'].concat(MEASURE[k], ['func', 'inform']); },
    install: function (k) {
      var mid = { hp: ['i_press', 'i_flush', 'i_elec'], gas: ['g_tight', 'g_flue', 'i_press'], ac: ['i_vac', 'i_ref', 'i_elec'], vent: ['i_duct', 'v_sup', 'v_ext'], solar: ['i_fill', 'o_press'] }[k];
      return ['i_deliv', 'i_mount'].concat(mid, ['func', 'i_doc', 'inform', 'clean']);
    },
    commission: function (k) {
      var mid = { hp: ['h_press', 'h_flow', 'h_ret', 'h_hp', 'h_lp'], gas: ['g_tight', 'g_co', 'g_co2', 'g_press'], ac: ['a_supply', 'a_lp', 'a_leak'], vent: ['v_sup', 'v_ext', 'v_bypass'], solar: ['o_press', 'o_frost'] }[k];
      return ['c_check'].concat(mid, ['c_set', 'c_reg', 'c_train', 'func']);
    },
    warranty: function (k) { return ['w_label', 'visual', 'w_log'].concat(MEASURE[k], ['func', 'w_ok', 'inform']); }
  };
  function item(id) {
    var x = ITEMS[id], o = { id: id, en: x[0], sl: x[1], hr: x[2], t: x[3], unit: x[4] || '', req: !!x[5] };
    if (x[3] === 'num') { o.lo = x[6] == null ? null : x[6]; o.hi = x[7] == null ? null : x[7]; }
    if (x[8]) o.opts = x[8].map(function (q) { return { id: q[0], en: q[1], sl: q[2], hr: q[3] }; });
    return o;
  }
  /** one template per job type and kind of equipment, key 'type|kind' */
  function makeTemplates() {
    var out = {};
    E.TYPES.forEach(function (t) {
      E.KINDS.forEach(function (k) {
        var ids = typeof TEMPLATE_IDS[t.id] === 'function' ? TEMPLATE_IDS[t.id](k.id) : TEMPLATE_IDS[t.id][k.id];
        out[t.id + '|' + k.id] = { key: t.id + '|' + k.id, type: t.id, kind: k.id, items: ids.map(item) };
      });
    });
    return out;
  }

  // ── equipment ────────────────────────────────────────────────────────────
  // brand, model, refrigerant, charge kg, serial prefix, how often it fails (1 = average)
  var MODELS = {
    hp: [['Nordtherm', 'AWP 8 Mono', 'R290', 1.1, 'NT', 0.8], ['Nordtherm', 'AWP 12 Mono', 'R290', 1.5, 'NT', 0.9], ['Klimaflow', 'HydroSplit 9', 'R32', 1.8, 'KF', 1.1], ['Klimaflow', 'HydroSplit 14', 'R32', 2.6, 'KF', 1.2], ['Calorin', 'Aerotop 7', 'R32', 1.4, 'CL', 1.9]],
    gas: [['Nordtherm', 'CondensPro 24', '', 0, 'NT', 0.9], ['Nordtherm', 'CondensPro 35', '', 0, 'NT', 1], ['Calorin', 'Kondens 25 C', '', 0, 'CL', 2.1], ['Calorin', 'Kondens 30 S', '', 0, 'CL', 1.3]],
    ac: [['Klimaflow', 'Breeze 2.5', 'R32', 0.55, 'KF', 0.8], ['Klimaflow', 'Breeze 3.5', 'R32', 0.75, 'KF', 0.9], ['Klimaflow', 'Breeze 5.0', 'R32', 1.05, 'KF', 1], ['Frescala', 'Mistral 3.5', 'R32', 0.8, 'FR', 1.8], ['Frescala', 'Mistral 7.1', 'R410A', 1.6, 'FR', 1.5]],
    vent: [['Ventaro', 'Recu 300', '', 0, 'VR', 1], ['Ventaro', 'Recu 450', '', 0, 'VR', 1.1], ['Klimaflow', 'AirX 350', '', 0, 'KF', 1.4]],
    solar: [['Solarix', 'SunTherm 2 × 2.5 m², 300 l', '', 0, 'SX', 1], ['Solarix', 'SunTherm 3 × 2.5 m², 400 l', '', 0, 'SX', 1]]
  };
  var MODEL_W = { hp: [30, 20, 22, 12, 16], gas: [34, 22, 24, 20], ac: [22, 34, 16, 18, 10], vent: [45, 30, 25], solar: [60, 40] };
  var VENT_FILTER = { 'Recu 300': 'VT-FLT-300', 'Recu 450': 'VT-FLT-450', 'AirX 350': 'VT-FLT-350' };
  var LOC = {
    household: {
      hp: ['Outdoor unit by the north wall, hydro unit in the utility room', 'Outdoor unit behind the garage, indoor unit in the basement', 'Monoblock on the terrace, buffer tank in the boiler room'],
      gas: ['Boiler room in the basement', 'Wall-hung in the kitchen', 'Utility room next to the garage', 'Attic, access over a ladder'],
      ac: ['Living room, outdoor unit on the balcony', 'Bedroom, outdoor unit on the east wall', 'Attic study, outdoor unit on the roof terrace', 'Kids\' room, outdoor unit above the garage door'],
      vent: ['Unit in the attic, hatch in the hallway', 'Unit in the utility room', 'Unit above the garage ceiling'],
      solar: ['Collectors on the south roof, tank in the boiler room', 'Collectors on the garage roof, tank in the basement']
    },
    business: {
      hp: ['Plant room behind the building'], gas: ['Boiler room, ground floor', 'Plant room in the basement'],
      ac: ['Server room', 'Ground-floor office', 'Shop floor', 'Meeting room', 'Reception', 'Kitchen', 'First-floor office'],
      vent: ['Plant room on the roof', 'Ceiling of the dining area'], solar: ['Roof, tank in the plant room']
    }
  };
  LOC.public = { hp: ['Plant room'], gas: ['Boiler room in the basement', 'Boiler room, east wing'], ac: ['Staff room', 'Head office', 'Server cabinet room', 'Library reading room'], vent: ['Gym plant room', 'Roof plant room', 'Classroom wing plant room'], solar: ['Roof of the gym'] };

  // ── names, places ────────────────────────────────────────────────────────
  var SL_M = ['Marko', 'Janez', 'Andrej', 'Matjaž', 'Boštjan', 'Primož', 'Tomaž', 'Jure', 'Rok', 'Luka', 'Gregor', 'Blaž', 'Aleš', 'Uroš', 'Damjan', 'Mitja', 'Igor', 'Simon', 'Peter', 'Miha', 'Žiga', 'Klemen', 'Domen', 'Anže', 'Franc', 'Jožef', 'Stanko', 'Zdravko', 'Bojan', 'Robert'];
  var SL_F = ['Mojca', 'Petra', 'Maja', 'Nina', 'Katja', 'Barbara', 'Mateja', 'Tanja', 'Špela', 'Urška', 'Nataša', 'Alenka', 'Simona', 'Tina', 'Polona', 'Irena', 'Jožica', 'Marjeta', 'Vesna', 'Sabina', 'Lidija', 'Eva', 'Sara', 'Tjaša', 'Andreja', 'Darja', 'Metka', 'Zdenka'];
  var SL_S = ['Novak', 'Horvat', 'Krajnc', 'Kovačič', 'Zupančič', 'Potočnik', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Kralj', 'Zupan', 'Bizjak', 'Hribar', 'Kotnik', 'Rozman', 'Lesjak', 'Jelen', 'Petek', 'Kolar', 'Kladnik', 'Grobelnik', 'Pečnik', 'Ocvirk', 'Pušnik',
    'Brglez', 'Žnidaršič', 'Jurko', 'Plaskan', 'Videčnik', 'Rakun', 'Kolenc', 'Arzenšek', 'Majcen', 'Ribič', 'Šmid', 'Gorišek', 'Jakop', 'Leskovšek', 'Zidar', 'Vrečko', 'Cvikl', 'Pintar', 'Štor', 'Napotnik', 'Klinc', 'Golčer',
    'Mlinar', 'Kavčič', 'Žagar', 'Koren', 'Bezjak', 'Erjavec', 'Medved', 'Kovač', 'Zajc', 'Hočevar', 'Pirc', 'Rupnik', 'Sever', 'Košir', 'Oblak', 'Lah', 'Jereb', 'Gregorič', 'Vovk', 'Debeljak', 'Kastelic', 'Hren',
    'Zorko', 'Petrič', 'Bergant', 'Dolenc', 'Mohorič', 'Furlan', 'Fras', 'Kokol', 'Jug', 'Tomažič', 'Hribernik', 'Korošec', 'Ferk', 'Planinšek', 'Selčan', 'Ojsteršek', 'Verbič', 'Brežnik', 'Lipovšek', 'Kovše', 'Ulaga',
    'Kotar', 'Strnad', 'Vodopivec', 'Čeh', 'Volk', 'Pavlič', 'Lešnik', 'Turnšek', 'Jazbec', 'Stopar', 'Gorjup', 'Senica', 'Založnik'];
  var HR_M = ['Ivan', 'Tomislav', 'Josip', 'Dario', 'Goran', 'Mario', 'Zoran'];
  var HR_F = ['Ivana', 'Marija', 'Ana', 'Snježana', 'Jelena', 'Martina'];
  var HR_S = ['Babić', 'Kovačević', 'Jurić', 'Marić', 'Perić', 'Knežević', 'Vuković', 'Šimić', 'Pavlović', 'Matić'];
  // customers just across the border in Croatia (Hum na Sutli, Pregrada): Croatian streets and kinds of business
  var HR_STREETS = ['Zagorska ulica', 'Ulica Ljudevita Gaja', 'Trg Gospe Kunagorske', 'Ulica Stjepana Radića', 'Sutlanska ulica', 'Ulica Augusta Šenoe', 'Vinogradska ulica', 'Lipovečka ulica'];
  var HR_BIZ_TYPES = ['Pekara', 'Gostionica', 'Autoservis', 'Stomatološka ordinacija', 'Frizerski salon', 'Stolarija', 'Trgovina', 'Pansion', 'Vinarija', 'Računovodstvo', 'Staklarstvo', 'Kafić'];
  var HR_PUBLIC_TYPES = ['Osnovna škola', 'Dječji vrtić', 'Dom zdravlja', 'Narodna knjižnica', 'Vatrogasni dom', 'Društveni dom'];
  var ROLES = ['facilities', 'office manager', 'owner', 'caretaker', 'operations', 'maintenance'];
  // businesses and public bodies: a kind of business or institution plus a name, all made up
  var BIZ_TYPES = ['Pekarna', 'Gostilna', 'Avtoservis', 'Zobna ordinacija', 'Frizerski salon', 'Mizarstvo', 'Trgovina', 'Penzion', 'Fitnes', 'Računovodstvo', 'Vrtnarija', 'Steklarstvo', 'Tiskarna',
    'Kavarna', 'Apartmaji', 'Veterinarska ambulanta', 'Optika', 'Mesnica', 'Gostišče', 'Gradbeni material', 'Logistika', 'Poslovni center', 'Hotel', 'Wellness', 'Pizzeria', 'Elektro', 'Cvetličarna',
    'Kozmetični salon', 'Slaščičarna', 'Ključavničarstvo', 'Turistična kmetija', 'Plesni studio', 'Arhitekturni biro', 'Pralnica', 'Vinoteka', 'Odvetniška pisarna', 'Avtopralnica', 'Kovinarstvo',
    'Fotostudio', 'Knjigovodstvo', 'Prevozi', 'Mehanična delavnica', 'Market', 'Okrepčevalnica', 'Nepremičnine', 'Tapetništvo', 'Strojna obdelava', 'Fizioterapija'];
  var BIZ_WORDS = ['Zrno', 'Lipa', 'Mozaik', 'Ritem', 'Snežinka', 'Trta', 'Lotos', 'Medenjak', 'Vijolica', 'Atlas', 'Breg', 'Sonček', 'Mavrica', 'Javor', 'Gaber', 'Iskra', 'Zarja', 'Svit', 'Kresnica',
    'Detelja', 'Klas', 'Biser', 'Polet', 'Kristal', 'Studenec', 'Ajda', 'Ob Savinji', 'Na Vrhu', 'Pri Starem Mlinu', 'Pod Lipo', 'Pri Mostu', 'Na Griču', 'Zelena Dolina', 'Topla Dolina', 'Grajski Vrt'];
  var PUBLIC_TYPES = ['Osnovna šola', 'Vrtec', 'Dom upokojencev', 'Zdravstvena postaja', 'Knjižnica', 'Športna dvorana', 'Glasbena šola', 'Gasilski dom', 'Mladinski center', 'Dom krajanov', 'Kulturni dom', 'Krajevna skupnost'];
  var PUBLIC_WORDS = ['Lipa', 'Brin', 'Breza', 'Vrba', 'Javor', 'Hrast', 'Jelka', 'Bukev', 'Gaber', 'Smreka', 'Dren', 'Jesen', 'Leska', 'Jelša', 'Bor', 'Macesen', 'Tisa', 'Brest', 'Kostanj', 'Oreh'];
  var STREETS = ['Cankarjeva ulica', 'Prešernova ulica', 'Gregorčičeva ulica', 'Levstikova ulica', 'Kidričeva cesta', 'Trubarjeva ulica', 'Partizanska cesta', 'Ljubljanska cesta', 'Savinjska cesta', 'Vrtna ulica', 'Sončna ulica',
    'Cesta talcev', 'Aškerčeva ulica', 'Kajuhova ulica', 'Lipova ulica', 'Ob potoku', 'Pod gozdom', 'Na zelenici', 'Šolska ulica', 'Kersnikova ulica', 'Jurčičeva ulica', 'Tomšičeva ulica', 'Gubčeva ulica', 'Koroška cesta', 'Brezova ulica',
    'Cesta na grad', 'Pot na polje', 'Jelenova ulica', 'Ulica bratov Mravljakov', 'Hmeljarska ulica'];
  var BIZ_STREETS = ['Industrijska cesta', 'Obrtna cesta', 'Mariborska cesta', 'Ljubljanska cesta', 'Glavni trg', 'Trg svobode', 'Celjska cesta', 'Tovarniška cesta'];
  var TOWN_W = [['Celje', 30], ['Žalec', 10], ['Velenje', 13], ['Laško', 6], ['Šentjur', 7], ['Slovenske Konjice', 6], ['Šmarje pri Jelšah', 4], ['Mozirje', 4], ['Ljubljana', 3], ['Vojnik', 3], ['Štore', 2],
    ['Polzela', 3], ['Šoštanj', 3], ['Prebold', 2], ['Rogaška Slatina', 2], ['Zreče', 1.5], ['Nazarje', 1], ['Braslovče', 1.5], ['Hum na Sutli', 0.7], ['Pregrada', 0.5]];
  var ACCESS = ['Gate code {code}#', 'Dog in the yard: ring the bell and wait.', 'Key with the neighbour at no. {no} if nobody is home.', 'Park in front of the garage, not on the street.', 'Boiler room in the basement, entrance at the back.',
    'Call 30 minutes before arrival.', 'Narrow driveway: park on the main road.', 'Two cats in the house, keep the doors closed.', 'Only after 9:00 please.', 'Outdoor unit on the flat roof: ladder needed.'];
  var ACCESS_BIZ = ['Report to the reception first.', 'Delivery entrance from the courtyard.', 'Ask for the caretaker (ext. {no}).', 'Open Mon–Fri 7:00–15:00 only.', 'Use the side entrance; the main door is for clients.', 'Roof access key at the reception.'];

  // ── texts ────────────────────────────────────────────────────────────────
  // repairs: what the customer reports, how urgent it sounds, and the fixes that fit it
  var FIXES = { // key: [part used ('' = none), note]
    gas: {
      ign: ['GB-ELC-01', 'Ignition electrode worn, replaced. Boiler ignites reliably, tested three cycles.'], ion: ['GB-ION-01', 'Ionisation electrode worn, replaced. Flame signal stable.'],
      gv: ['GB-GV-01', 'Gas valve did not open reliably, replaced and tightness tested.'], pcb: ['GB-PCB-01', 'Control board faulty, replaced and set up. Boiler runs normally.'],
      prs: ['GB-PRS-01', 'Water pressure sensor faulty, replaced. System refilled to 1.5 bar.'], exp: ['GB-EXP-08', 'Expansion vessel lost its pre-charge, replaced. Pressure holds at 1.5 bar.'],
      seal: ['GN-SEA-01', 'Leaking seal on the heating return replaced, system refilled to 1.5 bar.'], dwv: ['GB-3WV-01', 'Diverter valve motor replaced; hot water works again.'],
      ntc: ['GB-NTC-01', 'Hot water NTC sensor faulty, replaced. Hot water temperature is right again.'], pmp: ['GB-PMP-01', 'Circulation pump seized, replaced and the system vented.'],
      air: ['', 'Air in the boiler and the radiators, vented and refilled to 1.6 bar. No parts needed.'], fan: ['GB-FAN-01', 'Fan bearing worn, burner fan replaced. Combustion values checked after the repair.'],
      sif: ['GB-SIF-01', 'Condensate siphon blocked and cracked, replaced. Error cleared.']
    },
    hp: {
      oat: ['HP-OAT-01', 'Outdoor temperature sensor faulty, replaced. Heating curve works again.'], fls: ['HP-FLS-01', 'Flow switch replaced; error cleared, flow normal.'],
      air: ['', 'Air in the system, vented at all points and refilled. Pressure 1.6 bar.'], mag: ['HP-MAG-01', 'Magnetic filter clogged, cartridge replaced. Flow back to normal.'],
      fan: ['HP-FAN-01', 'Fan motor of the outdoor unit replaced. Noise gone.'], eev: ['HP-EEV-01', 'Expansion valve coil faulty, replaced. Defrost cycle tested.'],
      htr: ['HP-HTR-03', 'Backup heater element shorted, replaced. The breaker holds.'], inv: ['HP-INV-01', 'Inverter board failed, replaced and tested in heating and hot water mode.'],
      ano: ['HP-ANO-01', 'Hot water tank anode used up, replaced; legionella cycle checked.'], ctl: ['HP-CTL-01', 'Room controller faulty, replaced and paired.'],
      sv: ['HP-SV3-01', 'Safety valve dripping, replaced.'], aav: ['HP-AAV-01', 'Automatic air vent leaking, replaced.']
    },
    ac: {
      drain: ['', 'Condensate drain blocked, cleaned and flushed. No more dripping.'], pump: ['AC-PMP-01', 'Condensate pump failed, replaced.'],
      cap: ['AC-CAP-01', 'Fan capacitor replaced; the outdoor fan runs again and the unit cools normally.'], leak: ['RF-R32', 'Leak on a flare nut fixed, refrigerant topped up.'],
      clean: ['GN-DIS-01', 'Indoor unit cleaned and disinfected; the smell is gone.'], rmt: ['AC-RMT-01', 'Remote control replaced.'],
      pcb: ['AC-PCB-01', 'Indoor unit control board faulty, replaced.'], sns: ['AC-SNS-01', 'Coil sensor faulty, replaced.'],
      fmo: ['AC-FMO-01', 'Outdoor fan motor replaced, vibration gone.'], dmp: ['GN-DMP-01', 'Anti-vibration pads under the outdoor unit replaced, bracket tightened.']
    },
    vent: {
      fan: ['VT-FAN-01', 'EC fan replaced; noise gone.'], byp: ['VT-BYP-01', 'Bypass actuator stuck, replaced and tested.'], hose: ['GN-CDH-01', 'Condensate hose disconnected, replaced and sealed.'],
      hum: ['VT-HUM-01', 'Humidity sensor replaced; boost mode works again.'], reset: ['', 'Filter alarm counter reset and filters checked.'], ctl: ['VT-CTL-01', 'Control panel faulty, replaced and set up.']
    },
    solar: {
      leak: ['SL-FLD-10', 'Leak on the collector connection sealed, system refilled with solar fluid.'], sns: ['SL-PT1-01', 'Collector sensor replaced; the controller shows the right temperatures.'],
      pst: ['SL-PST-01', 'Pump station replaced, system vented.'], ctl: ['SL-CTL-01', 'Solar controller faulty, replaced and set up.']
    }
  };
  var PROBLEMS = { // text, sounds urgent, fixes that fit
    gas: [['No heating, boiler shows error F28 (no ignition).', 1, ['ign', 'ion', 'gv', 'pcb']], ['Boiler loses pressure, has to be refilled every few days.', 0, ['exp', 'seal', 'prs']], ['No hot water, heating works.', 1, ['dwv', 'ntc']],
      ['Boiler makes a loud whistling noise when heating.', 0, ['pmp', 'air', 'fan']], ['Water dripping under the boiler.', 0, ['sif', 'seal']], ['Boiler switches off after a few minutes, error E133.', 1, ['ion', 'gv', 'fan']]],
    hp: [['Heat pump not heating, outdoor unit not running.', 1, ['inv', 'fan', 'oat']], ['Error E07 on the controller: low flow.', 1, ['fls', 'mag', 'air']], ['Outdoor unit iced up and does not defrost.', 1, ['eev', 'oat']],
      ['Loud noise from the outdoor unit fan.', 0, ['fan']], ['Hot water does not reach the set temperature.', 0, ['ano', 'htr', 'ctl']], ['Heat pump trips the circuit breaker.', 1, ['htr', 'inv']], ['Water dripping from the safety valve.', 0, ['sv', 'aav']]],
    ac: [['Air conditioner does not cool, blows warm air.', 1, ['cap', 'leak', 'sns']], ['Water dripping from the indoor unit.', 0, ['drain', 'pump']], ['Indoor unit smells musty when switched on.', 0, ['clean']],
      ['Remote control does not respond, display blinks.', 0, ['rmt', 'pcb']], ['Outdoor unit vibrates and is very loud.', 0, ['fmo', 'dmp']]],
    vent: [['Ventilation unit very loud on level 2.', 0, ['fan']], ['Filter alarm stays on after the filter change.', 0, ['reset', 'ctl']], ['Condensate leaking from the unit in the attic.', 0, ['hose']],
      ['Supply air is cold, bypass seems stuck open.', 0, ['byp']], ['Boost mode does not start when someone showers.', 0, ['hum']]],
    solar: [['Solar circuit pressure drops to zero.', 0, ['leak']], ['Solar pump runs at night and the tank cools down.', 0, ['ctl', 'sns']], ['Collector sensor shows −30 °C.', 0, ['sns']], ['Solar pump is noisy and the circuit does not heat.', 0, ['pst']]]
  };
  var SERVICE_NOTES = {
    gas: ['Annual service done. Burner and heat exchanger cleaned, condensate siphon flushed, flue gas values within range.', 'Annual service done. Electrodes adjusted, burner door gasket replaced. Combustion values good.',
      'Service done. System pressure was low (0.8 bar), refilled to 1.5 bar. Customer to watch the pressure for two weeks.', 'Annual service done. Flue checked, CO and CO₂ within range. No remarks.'],
    hp: ['Annual service done. Outdoor coil cleaned, magnetic filter cleaned, error log empty.', 'Service done. Water filter was clogged, cleaned. Flow and return temperatures normal afterwards.',
      'Annual service done. Heating curve lowered by one step at the customer\'s request.', 'Service done. Refrigerant pressures normal, no leaks found. Firmware up to date.'],
    ac: ['Annual service done. Filters cleaned, indoor coil disinfected, condensate drain flushed.', 'Service done. Outdoor coil was dirty, cleaned. Cooling test OK.', 'Annual service done. Remote control batteries replaced. Unit works normally.'],
    vent: ['Filters replaced, heat exchanger cleaned, air flows measured and balanced.', 'Service done. Filters replaced, condensate drain cleaned. Bypass works.', 'Filters were very dirty after six months; replaced. Customer advised to watch the filter alarm.'],
    solar: ['Solar fluid checked: frost protection and pH within range. Pump station and controller OK.', 'Service done. Collectors and fixings checked, system pressure topped up.']
  };
  var OTHER_NOTES = {
    install: ['Installed as per the quote. System filled, tested and handed over. Equipment is invoiced separately from the quote.', 'Unit installed and connected. Customer shown basic operation. Equipment is invoiced separately from the quote.'],
    commission: ['Commissioning done, parameters set, warranty registered with the manufacturer.', 'Started up and tested in heating and hot water mode. Customer instructed.'],
    warranty: ['Warranty inspection done, no defects found.', 'Warranty check done; firmware updated, error log empty.']
  };
  var CANCEL = ['Customer cancelled: fault cleared after a restart.', 'Duplicate of another job.', 'Customer postponed to next season.', 'Customer chose another installer.'];

  // ── the demo texts in Slovene and Croatian, for the service report ──────
  // The app is in English; a report printed in Slovene or Croatian shows these texts in that language. Only texts the
  // demo wrote are translated: anything a person typed or changed is printed as it is.
  var TR = {
    'Annual service as per the service plan.': ['Letni servis po servisnem paketu.', 'Godišnji servis prema servisnom paketu.'],
    'Annual service, customer called.': ['Letni servis, naročnik je poklical.', 'Godišnji servis, naručitelj je nazvao.'],
    'Annual service.': ['Letni servis.', 'Godišnji servis.'],
    'Error log read. Checking the sensors next.': ['Dnevnik napak odčitan. Naslednji korak: pregled tipal.', 'Zapis grešaka očitan. Sljedeće: provjera osjetnika.'],
    'No heating and no hot water, boiler shows error F28. Elderly customer at home.': ['Ni ogrevanja in ni tople vode, kotel javlja napako F28. Doma je starejša oseba.', 'Nema grijanja ni tople vode, kotao javlja grešku F28. Kod kuće je starija osoba.'],
    'Air conditioner in the server room stopped cooling, room at 31 °C.': ['Klimatska naprava v strežniški sobi ne hladi več, v prostoru je 31 °C.', 'Klima-uređaj u serverskoj sobi prestao je hladiti, u prostoriji je 31 °C.'],
    // problems
    'No heating, boiler shows error F28 (no ignition).': ['Ni ogrevanja, kotel javlja napako F28 (ni vžiga).', 'Nema grijanja, kotao javlja grešku F28 (nema paljenja).'],
    'Boiler loses pressure, has to be refilled every few days.': ['Kotel izgublja tlak, dopolnjevati ga je treba vsakih nekaj dni.', 'Kotao gubi tlak, mora se dopunjavati svakih nekoliko dana.'],
    'No hot water, heating works.': ['Ni tople vode, ogrevanje deluje.', 'Nema tople vode, grijanje radi.'],
    'Boiler makes a loud whistling noise when heating.': ['Kotel med ogrevanjem glasno piska.', 'Kotao tijekom grijanja glasno zviždi.'],
    'Water dripping under the boiler.': ['Pod kotlom kaplja voda.', 'Ispod kotla kapa voda.'],
    'Boiler switches off after a few minutes, error E133.': ['Kotel se po nekaj minutah izklopi, napaka E133.', 'Kotao se isključi nakon nekoliko minuta, greška E133.'],
    'Heat pump not heating, outdoor unit not running.': ['Toplotna črpalka ne greje, zunanja enota ne deluje.', 'Dizalica topline ne grije, vanjska jedinica ne radi.'],
    'Error E07 on the controller: low flow.': ['Na regulatorju napaka E07: premajhen pretok.', 'Na regulatoru greška E07: premali protok.'],
    'Outdoor unit iced up and does not defrost.': ['Zunanja enota je zaledenela in se ne odtaja.', 'Vanjska jedinica je zaleđena i ne odmrzava se.'],
    'Loud noise from the outdoor unit fan.': ['Ventilator zunanje enote je zelo glasen.', 'Ventilator vanjske jedinice vrlo je bučan.'],
    'Hot water does not reach the set temperature.': ['Topla voda ne doseže nastavljene temperature.', 'Topla voda ne postiže zadanu temperaturu.'],
    'Heat pump trips the circuit breaker.': ['Toplotna črpalka izklaplja varovalko.', 'Dizalica topline izbacuje osigurač.'],
    'Water dripping from the safety valve.': ['Iz varnostnega ventila kaplja voda.', 'Iz sigurnosnog ventila kapa voda.'],
    'Air conditioner does not cool, blows warm air.': ['Klimatska naprava ne hladi, piha topel zrak.', 'Klima-uređaj ne hladi, puše topao zrak.'],
    'Water dripping from the indoor unit.': ['Iz notranje enote kaplja voda.', 'Iz unutarnje jedinice kapa voda.'],
    'Indoor unit smells musty when switched on.': ['Notranja enota ob vklopu zaudarja po plesni.', 'Unutarnja jedinica pri uključivanju zaudara na plijesan.'],
    'Remote control does not respond, display blinks.': ['Daljinski upravljalnik se ne odziva, zaslon utripa.', 'Daljinski upravljač ne reagira, zaslon treperi.'],
    'Outdoor unit vibrates and is very loud.': ['Zunanja enota vibrira in je zelo glasna.', 'Vanjska jedinica vibrira i vrlo je bučna.'],
    'Ventilation unit very loud on level 2.': ['Prezračevalna naprava je na stopnji 2 zelo glasna.', 'Ventilacijski uređaj na stupnju 2 vrlo je bučan.'],
    'Filter alarm stays on after the filter change.': ['Opozorilo za filtre po menjavi filtrov ostane prižgano.', 'Upozorenje za filtre ostaje uključeno nakon zamjene filtera.'],
    'Condensate leaking from the unit in the attic.': ['Iz naprave na podstrešju teče kondenz.', 'Iz uređaja na tavanu curi kondenzat.'],
    'Supply air is cold, bypass seems stuck open.': ['Dovodni zrak je hladen, obvod je verjetno obtičal odprt.', 'Dobavni zrak je hladan, bypass je vjerojatno zapeo otvoren.'],
    'Boost mode does not start when someone showers.': ['Intenzivno prezračevanje se med prhanjem ne vklopi.', 'Pojačani način rada ne uključuje se tijekom tuširanja.'],
    'Solar circuit pressure drops to zero.': ['Tlak v solarnem krogu pade na nič.', 'Tlak u solarnom krugu pada na nulu.'],
    'Solar pump runs at night and the tank cools down.': ['Solarna črpalka deluje ponoči in hranilnik se ohlaja.', 'Solarna pumpa radi noću i spremnik se hladi.'],
    'Collector sensor shows −30 °C.': ['Tipalo kolektorja kaže −30 °C.', 'Osjetnik kolektora pokazuje −30 °C.'],
    'Solar pump is noisy and the circuit does not heat.': ['Solarna črpalka je glasna in krog ne greje.', 'Solarna pumpa je bučna i krug ne grije.'],
    // repairs: what was done
    'Ignition electrode worn, replaced. Boiler ignites reliably, tested three cycles.': ['Vžigalna elektroda obrabljena, zamenjana. Kotel zanesljivo vžge, preizkušeno v treh ciklih.', 'Elektroda za paljenje istrošena, zamijenjena. Kotao pouzdano pali, ispitano u tri ciklusa.'],
    'Ionisation electrode worn, replaced. Flame signal stable.': ['Ionizacijska elektroda obrabljena, zamenjana. Signal plamena je stabilen.', 'Ionizacijska elektroda istrošena, zamijenjena. Signal plamena je stabilan.'],
    'Gas valve did not open reliably, replaced and tightness tested.': ['Plinski ventil se ni zanesljivo odpiral, zamenjan in preizkušen na tesnost.', 'Plinski ventil nije se pouzdano otvarao, zamijenjen i ispitan na nepropusnost.'],
    'Control board faulty, replaced and set up. Boiler runs normally.': ['Krmilna elektronika v okvari, zamenjana in nastavljena. Kotel deluje normalno.', 'Upravljačka elektronika neispravna, zamijenjena i podešena. Kotao radi normalno.'],
    'Water pressure sensor faulty, replaced. System refilled to 1.5 bar.': ['Tipalo tlaka vode v okvari, zamenjano. Sistem dopolnjen na 1,5 bar.', 'Osjetnik tlaka vode neispravan, zamijenjen. Sustav dopunjen na 1,5 bar.'],
    'Expansion vessel lost its pre-charge, replaced. Pressure holds at 1.5 bar.': ['Raztezna posoda je izgubila predtlak, zamenjana. Tlak se drži na 1,5 bar.', 'Ekspanzijska posuda izgubila je predtlak, zamijenjena. Tlak se drži na 1,5 bar.'],
    'Leaking seal on the heating return replaced, system refilled to 1.5 bar.': ['Puščajoče tesnilo na povratku ogrevanja zamenjano, sistem dopolnjen na 1,5 bar.', 'Brtva koja je curila na povratu grijanja zamijenjena, sustav dopunjen na 1,5 bar.'],
    'Diverter valve motor replaced; hot water works again.': ['Pogon preklopnega ventila zamenjan; topla voda spet deluje.', 'Motor preklopnog ventila zamijenjen; topla voda ponovno radi.'],
    'Hot water NTC sensor faulty, replaced. Hot water temperature is right again.': ['NTC tipalo tople vode v okvari, zamenjano. Temperatura tople vode je spet pravilna.', 'NTC osjetnik tople vode neispravan, zamijenjen. Temperatura tople vode ponovno je ispravna.'],
    'Circulation pump seized, replaced and the system vented.': ['Obtočna črpalka zablokirana, zamenjana, sistem odzračen.', 'Cirkulacijska pumpa blokirala, zamijenjena, sustav odzračen.'],
    'Air in the boiler and the radiators, vented and refilled to 1.6 bar. No parts needed.': ['Zrak v kotlu in radiatorjih, odzračeno in dopolnjeno na 1,6 bar. Brez menjave delov.', 'Zrak u kotlu i radijatorima, odzračeno i dopunjeno na 1,6 bar. Bez zamjene dijelova.'],
    'Fan bearing worn, burner fan replaced. Combustion values checked after the repair.': ['Ležaj ventilatorja obrabljen, ventilator gorilnika zamenjan. Po popravilu preverjene vrednosti zgorevanja.', 'Ležaj ventilatora istrošen, ventilator plamenika zamijenjen. Nakon popravka provjerene vrijednosti izgaranja.'],
    'Condensate siphon blocked and cracked, replaced. Error cleared.': ['Sifon za kondenz zamašen in počen, zamenjan. Napaka odpravljena.', 'Sifon kondenzata začepljen i napuknut, zamijenjen. Greška otklonjena.'],
    'Outdoor temperature sensor faulty, replaced. Heating curve works again.': ['Zunanje temperaturno tipalo v okvari, zamenjano. Ogrevalna krivulja spet deluje.', 'Vanjski osjetnik temperature neispravan, zamijenjen. Krivulja grijanja ponovno radi.'],
    'Flow switch replaced; error cleared, flow normal.': ['Pretočno stikalo zamenjano; napaka odpravljena, pretok normalen.', 'Sklopka protoka zamijenjena; greška otklonjena, protok normalan.'],
    'Air in the system, vented at all points and refilled. Pressure 1.6 bar.': ['Zrak v sistemu, odzračeno na vseh mestih in dopolnjeno. Tlak 1,6 bar.', 'Zrak u sustavu, odzračeno na svim mjestima i dopunjeno. Tlak 1,6 bar.'],
    'Magnetic filter clogged, cartridge replaced. Flow back to normal.': ['Magnetni filter zamašen, vložek zamenjan. Pretok spet normalen.', 'Magnetski filtar začepljen, uložak zamijenjen. Protok ponovno normalan.'],
    'Fan motor of the outdoor unit replaced. Noise gone.': ['Motor ventilatorja zunanje enote zamenjan. Hrupa ni več.', 'Motor ventilatora vanjske jedinice zamijenjen. Buke više nema.'],
    'Expansion valve coil faulty, replaced. Defrost cycle tested.': ['Tuljava ekspanzijskega ventila v okvari, zamenjana. Preizkušen cikel odtaljevanja.', 'Zavojnica ekspanzijskog ventila neispravna, zamijenjena. Ispitan ciklus odmrzavanja.'],
    'Backup heater element shorted, replaced. The breaker holds.': ['Električni grelnik v kratkem stiku, zamenjan. Varovalka zdrži.', 'Električni grijač u kratkom spoju, zamijenjen. Osigurač drži.'],
    'Inverter board failed, replaced and tested in heating and hot water mode.': ['Inverterska plošča odpovedala, zamenjana in preizkušena pri ogrevanju in pripravi tople vode.', 'Inverterska pločica otkazala, zamijenjena i ispitana u grijanju i pripremi tople vode.'],
    'Hot water tank anode used up, replaced; legionella cycle checked.': ['Anoda hranilnika tople vode izrabljena, zamenjana; preverjen cikel proti legioneli.', 'Anoda spremnika tople vode istrošena, zamijenjena; provjeren ciklus protiv legionele.'],
    'Room controller faulty, replaced and paired.': ['Sobni regulator v okvari, zamenjan in povezan.', 'Sobni regulator neispravan, zamijenjen i uparen.'],
    'Safety valve dripping, replaced.': ['Varnostni ventil je kapljal, zamenjan.', 'Sigurnosni ventil je kapao, zamijenjen.'],
    'Automatic air vent leaking, replaced.': ['Avtomatski odzračevalnik je puščal, zamenjan.', 'Automatski odzračni ventil je curio, zamijenjen.'],
    'Condensate drain blocked, cleaned and flushed. No more dripping.': ['Odtok kondenza zamašen, očiščen in izpran. Ne kaplja več.', 'Odvod kondenzata začepljen, očišćen i ispran. Više ne kapa.'],
    'Condensate pump failed, replaced.': ['Črpalka za kondenz odpovedala, zamenjana.', 'Pumpa kondenzata otkazala, zamijenjena.'],
    'Fan capacitor replaced; the outdoor fan runs again and the unit cools normally.': ['Kondenzator ventilatorja zamenjan; zunanji ventilator spet deluje, naprava normalno hladi.', 'Kondenzator ventilatora zamijenjen; vanjski ventilator ponovno radi, uređaj normalno hladi.'],
    'Leak on a flare nut fixed, refrigerant topped up.': ['Netesnost na holandski matici odpravljena, hladivo dopolnjeno.', 'Propuštanje na holender matici otklonjeno, rashladno sredstvo dopunjeno.'],
    'Indoor unit cleaned and disinfected; the smell is gone.': ['Notranja enota očiščena in razkužena; vonja ni več.', 'Unutarnja jedinica očišćena i dezinficirana; mirisa više nema.'],
    'Remote control replaced.': ['Daljinski upravljalnik zamenjan.', 'Daljinski upravljač zamijenjen.'],
    'Indoor unit control board faulty, replaced.': ['Elektronika notranje enote v okvari, zamenjana.', 'Elektronika unutarnje jedinice neispravna, zamijenjena.'],
    'Coil sensor faulty, replaced.': ['Tipalo uparjalnika v okvari, zamenjano.', 'Osjetnik isparivača neispravan, zamijenjen.'],
    'Outdoor fan motor replaced, vibration gone.': ['Motor zunanjega ventilatorja zamenjan, vibracij ni več.', 'Motor vanjskog ventilatora zamijenjen, vibracija više nema.'],
    'Anti-vibration pads under the outdoor unit replaced, bracket tightened.': ['Protivibracijske podloge pod zunanjo enoto zamenjane, konzola pritrjena.', 'Antivibracijski podlošci ispod vanjske jedinice zamijenjeni, konzola pritegnuta.'],
    'EC fan replaced; noise gone.': ['EC ventilator zamenjan; hrupa ni več.', 'EC ventilator zamijenjen; buke više nema.'],
    'Bypass actuator stuck, replaced and tested.': ['Pogon obvoda je obtičal, zamenjan in preizkušen.', 'Pogon obilaznice je zapeo, zamijenjen i ispitan.'],
    'Condensate hose disconnected, replaced and sealed.': ['Cev za kondenz se je snela, zamenjana in zatesnjena.', 'Crijevo za kondenzat se odspojilo, zamijenjeno i zabrtvljeno.'],
    'Humidity sensor replaced; boost mode works again.': ['Tipalo vlage zamenjano; intenzivno prezračevanje spet deluje.', 'Osjetnik vlage zamijenjen; pojačani način rada ponovno radi.'],
    'Filter alarm counter reset and filters checked.': ['Števec opozorila za filtre ponastavljen, filtri pregledani.', 'Brojač upozorenja za filtre resetiran, filteri pregledani.'],
    'Control panel faulty, replaced and set up.': ['Upravljalna plošča v okvari, zamenjana in nastavljena.', 'Upravljačka ploča neispravna, zamijenjena i podešena.'],
    'Leak on the collector connection sealed, system refilled with solar fluid.': ['Netesnost na priključku kolektorja zatesnjena, sistem dopolnjen s solarno tekočino.', 'Propuštanje na priključku kolektora zabrtvljeno, sustav dopunjen solarnom tekućinom.'],
    'Collector sensor replaced; the controller shows the right temperatures.': ['Tipalo kolektorja zamenjano; regulator kaže pravilne temperature.', 'Osjetnik kolektora zamijenjen; regulator pokazuje ispravne temperature.'],
    'Pump station replaced, system vented.': ['Črpalna postaja zamenjana, sistem odzračen.', 'Crpna stanica zamijenjena, sustav odzračen.'],
    'Solar controller faulty, replaced and set up.': ['Solarni regulator v okvari, zamenjan in nastavljen.', 'Solarni regulator neispravan, zamijenjen i podešen.'],
    // services, installations, commissioning, warranty checks
    'Annual service done. Burner and heat exchanger cleaned, condensate siphon flushed, flue gas values within range.': ['Letni servis opravljen. Gorilnik in toplotni izmenjevalnik očiščena, sifon za kondenz izpran, vrednosti dimnih plinov v mejah.', 'Godišnji servis obavljen. Plamenik i izmjenjivač topline očišćeni, sifon kondenzata ispran, vrijednosti dimnih plinova u granicama.'],
    'Annual service done. Electrodes adjusted, burner door gasket replaced. Combustion values good.': ['Letni servis opravljen. Elektrodi nastavljeni, tesnilo vrat gorilnika zamenjano. Vrednosti zgorevanja dobre.', 'Godišnji servis obavljen. Elektrode podešene, brtva vrata plamenika zamijenjena. Vrijednosti izgaranja dobre.'],
    'Service done. System pressure was low (0.8 bar), refilled to 1.5 bar. Customer to watch the pressure for two weeks.': ['Servis opravljen. Tlak v sistemu je bil nizek (0,8 bar), dopolnjeno na 1,5 bar. Naročnik naj dva tedna spremlja tlak.', 'Servis obavljen. Tlak u sustavu bio je nizak (0,8 bar), dopunjeno na 1,5 bar. Naručitelj neka dva tjedna prati tlak.'],
    'Annual service done. Flue checked, CO and CO₂ within range. No remarks.': ['Letni servis opravljen. Dimovod pregledan, CO in CO₂ v mejah. Brez pripomb.', 'Godišnji servis obavljen. Dimovod pregledan, CO i CO₂ u granicama. Bez primjedbi.'],
    'Annual service done. Outdoor coil cleaned, magnetic filter cleaned, error log empty.': ['Letni servis opravljen. Lamele zunanje enote in magnetni filter očiščeni, dnevnik napak prazen.', 'Godišnji servis obavljen. Lamele vanjske jedinice i magnetski filtar očišćeni, zapis grešaka prazan.'],
    'Service done. Water filter was clogged, cleaned. Flow and return temperatures normal afterwards.': ['Servis opravljen. Vodni filter je bil zamašen, očiščen. Temperaturi predtoka in povratka sta nato normalni.', 'Servis obavljen. Filtar vode bio je začepljen, očišćen. Temperature polaznog i povratnog voda nakon toga su normalne.'],
    "Annual service done. Heating curve lowered by one step at the customer's request.": ['Letni servis opravljen. Ogrevalna krivulja na željo naročnika znižana za eno stopnjo.', 'Godišnji servis obavljen. Krivulja grijanja na zahtjev naručitelja snižena za jedan stupanj.'],
    'Service done. Refrigerant pressures normal, no leaks found. Firmware up to date.': ['Servis opravljen. Tlaka hladiva normalna, brez netesnosti. Programska oprema je posodobljena.', 'Servis obavljen. Tlakovi rashladnog sredstva normalni, bez propuštanja. Programska oprema je ažurna.'],
    'Annual service done. Filters cleaned, indoor coil disinfected, condensate drain flushed.': ['Letni servis opravljen. Filtri očiščeni, uparjalnik razkužen, odtok kondenza izpran.', 'Godišnji servis obavljen. Filteri očišćeni, isparivač dezinficiran, odvod kondenzata ispran.'],
    'Service done. Outdoor coil was dirty, cleaned. Cooling test OK.': ['Servis opravljen. Kondenzator zunanje enote je bil umazan, očiščen. Preizkus hlajenja ustrezen.', 'Servis obavljen. Kondenzator vanjske jedinice bio je prljav, očišćen. Ispitivanje hlađenja u redu.'],
    'Annual service done. Remote control batteries replaced. Unit works normally.': ['Letni servis opravljen. Baterije daljinskega upravljalnika zamenjane. Naprava deluje normalno.', 'Godišnji servis obavljen. Baterije daljinskog upravljača zamijenjene. Uređaj radi normalno.'],
    'Filters replaced, heat exchanger cleaned, air flows measured and balanced.': ['Filtri zamenjani, toplotni izmenjevalnik očiščen, pretoki zraka izmerjeni in uravnoteženi.', 'Filteri zamijenjeni, izmjenjivač topline očišćen, protoci zraka izmjereni i uravnoteženi.'],
    'Service done. Filters replaced, condensate drain cleaned. Bypass works.': ['Servis opravljen. Filtri zamenjani, odtok kondenza očiščen. Obvod deluje.', 'Servis obavljen. Filteri zamijenjeni, odvod kondenzata očišćen. Bypass radi.'],
    'Filters were very dirty after six months; replaced. Customer advised to watch the filter alarm.': ['Filtri so bili po šestih mesecih zelo umazani; zamenjani. Naročniku svetovano, naj spremlja opozorilo za filtre.', 'Filteri su nakon šest mjeseci bili vrlo prljavi; zamijenjeni. Naručitelju savjetovano da prati upozorenje za filtre.'],
    'Solar fluid checked: frost protection and pH within range. Pump station and controller OK.': ['Solarna tekočina preverjena: protizmrzovalna zaščita in pH v mejah. Črpalna postaja in regulator delujeta brezhibno.', 'Solarna tekućina provjerena: zaštita od smrzavanja i pH u granicama. Crpna stanica i regulator rade ispravno.'],
    'Service done. Collectors and fixings checked, system pressure topped up.': ['Servis opravljen. Kolektorji in pritrditve pregledani, tlak v sistemu dopolnjen.', 'Servis obavljen. Kolektori i nosači pregledani, tlak u sustavu dopunjen.'],
    'Installed as per the quote. System filled, tested and handed over. Equipment is invoiced separately from the quote.': ['Montirano po ponudbi. Sistem napolnjen, preizkušen in predan. Oprema se zaračuna posebej po ponudbi.', 'Montirano prema ponudi. Sustav napunjen, ispitan i predan. Oprema se zaračunava zasebno prema ponudi.'],
    'Unit installed and connected. Customer shown basic operation. Equipment is invoiced separately from the quote.': ['Naprava montirana in priključena. Naročniku prikazano osnovno upravljanje. Oprema se zaračuna posebej po ponudbi.', 'Uređaj montiran i priključen. Naručitelju pokazano osnovno rukovanje. Oprema se zaračunava zasebno prema ponudi.'],
    'Commissioning done, parameters set, warranty registered with the manufacturer.': ['Zagon opravljen, parametri nastavljeni, garancija registrirana pri proizvajalcu.', 'Puštanje u rad obavljeno, parametri podešeni, jamstvo registrirano kod proizvođača.'],
    'Started up and tested in heating and hot water mode. Customer instructed.': ['Zagnano in preizkušeno pri ogrevanju in pripravi tople vode. Naročnik poučen o uporabi.', 'Pušteno u rad i ispitano u grijanju i pripremi tople vode. Naručitelj upućen u korištenje.'],
    'Warranty inspection done, no defects found.': ['Garancijski pregled opravljen, napak ni.', 'Jamstveni pregled obavljen, nedostataka nema.'],
    'Warranty check done; firmware updated, error log empty.': ['Garancijski pregled opravljen; programska oprema posodobljena, dnevnik napak prazen.', 'Jamstveni pregled obavljen; programska oprema ažurirana, zapis grešaka prazan.'],
    // cancellations, signatures, photos
    'Customer cancelled: fault cleared after a restart.': ['Naročnik je odpovedal: napaka je po ponovnem zagonu izginila.', 'Naručitelj je otkazao: kvar je nestao nakon ponovnog pokretanja.'],
    'Duplicate of another job.': ['Podvojeno naročilo.', 'Dvostruki nalog.'],
    'Customer postponed to next season.': ['Naročnik je preložil na naslednjo sezono.', 'Naručitelj je odgodio za sljedeću sezonu.'],
    'Customer chose another installer.': ['Naročnik je izbral drugega izvajalca.', 'Naručitelj je odabrao drugog izvođača.'],
    'Nobody at home; key with the neighbour. Report sent by e-mail.': ['Nikogar ni bilo doma; ključ pri sosedu. Poročilo poslano po e-pošti.', 'Nikoga nije bilo kod kuće; ključ kod susjeda. Izvješće poslano e-poštom.'],
    'Caretaker not available; report sent by e-mail.': ['Hišnik ni bil dosegljiv; poročilo poslano po e-pošti.', 'Domar nije bio dostupan; izvješće poslano e-poštom.'],
    'Outdoor unit iced up before the repair': ['Zaledenela zunanja enota pred popravilom', 'Zaleđena vanjska jedinica prije popravka'],
    'Burner after cleaning': ['Gorilnik po čiščenju', 'Plamenik nakon čišćenja'],
    'Fault found. Part ordered from Nordvik Distribucija.': ['Napaka ugotovljena. Del je naročen pri dobavitelju Nordvik Distribucija.', 'Kvar utvrđen. Dio je naručen kod dobavljača Nordvik Distribucija.'],
    // where the equipment is
    'Outdoor unit by the north wall, hydro unit in the utility room': ['Zunanja enota ob severni steni, hidravlični modul v gospodinjskem prostoru', 'Vanjska jedinica uz sjeverni zid, hidraulički modul u pomoćnoj prostoriji'],
    'Outdoor unit behind the garage, indoor unit in the basement': ['Zunanja enota za garažo, notranja enota v kleti', 'Vanjska jedinica iza garaže, unutarnja jedinica u podrumu'],
    'Monoblock on the terrace, buffer tank in the boiler room': ['Monoblok na terasi, hranilnik toplote v kotlovnici', 'Monoblok na terasi, akumulacijski spremnik u kotlovnici'],
    'Boiler room in the basement': ['Kotlovnica v kleti', 'Kotlovnica u podrumu'],
    'Wall-hung in the kitchen': ['Stenska montaža v kuhinji', 'Zidna montaža u kuhinji'],
    'Utility room next to the garage': ['Gospodinjski prostor ob garaži', 'Pomoćna prostorija uz garažu'],
    'Attic, access over a ladder': ['Podstrešje, dostop po lestvi', 'Tavan, pristup ljestvama'],
    'Living room, outdoor unit on the balcony': ['Dnevna soba, zunanja enota na balkonu', 'Dnevni boravak, vanjska jedinica na balkonu'],
    'Bedroom, outdoor unit on the east wall': ['Spalnica, zunanja enota na vzhodni steni', 'Spavaća soba, vanjska jedinica na istočnom zidu'],
    'Attic study, outdoor unit on the roof terrace': ['Delovna soba na podstrešju, zunanja enota na strešni terasi', 'Radna soba u potkrovlju, vanjska jedinica na krovnoj terasi'],
    "Kids' room, outdoor unit above the garage door": ['Otroška soba, zunanja enota nad garažnimi vrati', 'Dječja soba, vanjska jedinica iznad garažnih vrata'],
    'Unit in the attic, hatch in the hallway': ['Naprava na podstrešju, loputa v hodniku', 'Uređaj na tavanu, otvor u hodniku'],
    'Unit in the utility room': ['Naprava v gospodinjskem prostoru', 'Uređaj u pomoćnoj prostoriji'],
    'Unit above the garage ceiling': ['Naprava nad stropom garaže', 'Uređaj iznad stropa garaže'],
    'Collectors on the south roof, tank in the boiler room': ['Kolektorji na južni strehi, hranilnik v kotlovnici', 'Kolektori na južnom krovu, spremnik u kotlovnici'],
    'Collectors on the garage roof, tank in the basement': ['Kolektorji na strehi garaže, hranilnik v kleti', 'Kolektori na krovu garaže, spremnik u podrumu'],
    'Plant room behind the building': ['Strojnica za stavbo', 'Strojarnica iza zgrade'],
    'Boiler room, ground floor': ['Kotlovnica, pritličje', 'Kotlovnica, prizemlje'],
    'Plant room in the basement': ['Strojnica v kleti', 'Strojarnica u podrumu'],
    'Server room': ['Strežniška soba', 'Serverska soba'],
    'Ground-floor office': ['Pisarna v pritličju', 'Ured u prizemlju'],
    'Shop floor': ['Prodajni prostor', 'Prodajni prostor'],
    'Meeting room': ['Sejna soba', 'Sala za sastanke'],
    'Reception': ['Recepcija', 'Recepcija'],
    'Kitchen': ['Kuhinja', 'Kuhinja'],
    'First-floor office': ['Pisarna v prvem nadstropju', 'Ured na prvom katu'],
    'Plant room on the roof': ['Strojnica na strehi', 'Strojarnica na krovu'],
    'Ceiling of the dining area': ['Strop jedilnice', 'Strop blagovaonice'],
    'Roof, tank in the plant room': ['Streha, hranilnik v strojnici', 'Krov, spremnik u strojarnici'],
    'Plant room': ['Strojnica', 'Strojarnica'],
    'Boiler room, east wing': ['Kotlovnica, vzhodno krilo', 'Kotlovnica, istočno krilo'],
    'Staff room': ['Zbornica', 'Zbornica'],
    'Head office': ['Ravnateljeva pisarna', 'Ured ravnatelja'],
    'Server cabinet room': ['Prostor s strežniško omaro', 'Prostorija sa serverskim ormarom'],
    'Library reading room': ['Čitalnica knjižnice', 'Čitaonica knjižnice'],
    'Gym plant room': ['Strojnica telovadnice', 'Strojarnica dvorane'],
    'Roof plant room': ['Strojnica na strehi', 'Strojarnica na krovu'],
    'Classroom wing plant room': ['Strojnica učilniškega krila', 'Strojarnica krila s učionicama'],
    'Roof of the gym': ['Streha telovadnice', 'Krov dvorane']
  };
  var FOLLOW_TR = { 'the same fault came back.': ['ista napaka se je ponovila.', 'isti kvar se ponovio.'], 'the error shows again.': ['napaka se spet prikazuje.', 'greška se ponovno prikazuje.'],
    'the customer says the noise is back.': ['naročnik pravi, da se je hrup vrnil.', 'naručitelj kaže da se buka vratila.'] };
  var PART_LC = {}; // lower-case English part name → [sl, hr], for "Fault found: … faulty."
  function lcFirst(x) { return /^\S[a-zčšžćđ]/.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x; } // keeps NTC, EC, R32
  PARTS.forEach(function (p) { PART_LC[p.name.toLowerCase()] = [lcFirst(p.sl), lcFirst(p.hr)]; });
  // patterns with a model name, a job number or a part in them: [regex, sl, hr]
  var TR_RX = [
    [/^Install a new (.+) as per the quote\.$/, function (m) { return 'Montaža nove naprave ' + m[1] + ' po ponudbi.'; }, function (m) { return 'Montaža novog uređaja ' + m[1] + ' prema ponudi.'; }],
    [/^Commissioning of the new (.+)\.$/, function (m) { return 'Zagon nove naprave ' + m[1] + '.'; }, function (m) { return 'Puštanje u rad novog uređaja ' + m[1] + '.'; }],
    [/^Warranty inspection of the (.+)\.$/, function (m) { return 'Garancijski pregled naprave ' + m[1] + '.'; }, function (m) { return 'Jamstveni pregled uređaja ' + m[1] + '.'; }],
    [/^Follow-up to (\S+): (.+)$/, function (m) { var f = FOLLOW_TR[m[2]]; return f ? 'Ponovni obisk po ' + m[1] + ': ' + f[0] : null; }, function (m) { var f = FOLLOW_TR[m[2]]; return f ? 'Ponovni dolazak nakon ' + m[1] + ': ' + f[1] : null; }],
    [/^Fault found: (.+) faulty\. Part ordered from Nordvik Distribucija\.$/, function (m) { var p = PART_LC[m[1]]; return p ? 'Napaka ugotovljena, v okvari: ' + p[0] + '. Del je naročen pri dobavitelju Nordvik Distribucija.' : null; },
      function (m) { var p = PART_LC[m[1]]; return p ? 'Kvar utvrđen, neispravno: ' + p[1] + '. Dio je naručen kod dobavljača Nordvik Distribucija.' : null; }]
  ];
  /** a demo text in the report's language (sl / hr); English, or a text the demo did not write, comes back unchanged */
  function localText(s, lang) {
    if (typeof s !== 'string' || !s || (lang !== 'sl' && lang !== 'hr')) return s;
    var ix = lang === 'sl' ? 0 : 1, hit = TR[s];
    if (hit) return hit[ix];
    for (var i = 0; i < TR_RX.length; i++) { var m = TR_RX[i][0].exec(s); if (m) { var out = TR_RX[i][1 + ix](m); return out == null ? s : out; } }
    return s;
  }

  // ── signatures and demo pictures ─────────────────────────────────────────
  /** a deterministic squiggle that looks like a handwritten signature, as SVG markup */
  function squiggle(name) {
    var r = rng(hashStr(String(name || '?'))), f = function (x) { return Math.round(x * 10) / 10; };
    var n = Math.max(4, Math.min(9, String(name || '').replace(/[^A-Za-zÀ-žČŠŽčšžĆćĐđ]/g, '').length - 3)), x = 10, y = 44;
    var d = 'M' + x + ' ' + y;
    for (var i = 0; i < n; i++) {
      var w = 13 + r() * 13, up = 14 + r() * 24, dn = 3 + r() * 11, ny = 40 + (r() - 0.5) * 12;
      d += ' C' + f(x + w * 0.25) + ' ' + f(y - up) + ' ' + f(x + w * 0.75) + ' ' + f(y + dn) + ' ' + f(x + w) + ' ' + f(ny);
      x += w; y = ny;
    }
    var W = Math.ceil(x + 14);
    d += ' M' + f(8 + r() * 12) + ' ' + f(60 + r() * 6) + ' Q' + f(W * 0.5) + ' ' + f(70 + r() * 6) + ' ' + f(W - 6) + ' ' + f(54 + r() * 6);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' 80" width="' + W + '" height="80"><path d="' + d + '" fill="none" stroke="#1D2B64" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  /** clamp the demo clock to the middle of the working day */
  function demoClock(hm) { if (typeof hm !== 'string' || !/^\d{2}:\d{2}$/.test(hm)) hm = '10:40'; return hm < '10:40' ? '10:40' : hm > '15:50' ? '15:50' : hm; }

  // ── helpers for big lists ────────────────────────────────────────────────
  /** weighted choice in O(log n): list of [value, weight] → function (r) → value */
  function weighted(list) {
    var cum = [], tot = 0;
    list.forEach(function (x) { tot += x[1]; cum.push(tot); });
    return function (r) {
      var x = r() * tot, lo = 0, hi = cum.length - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1; }
      return list[lo][0];
    };
  }
  /** answers of a finished demo checklist, rebuilt from a seed, so stored past jobs do not have to carry them */
  function demoChecklist(items, seed, asset) {
    var r = rng(seed), res = {};
    (items || []).forEach(function (it) {
      if (!it || it.off) return;
      if (it.t === 'pf') { res[it.id] = !it.req && r() < 0.12 ? 'na' : 'pass'; return; }
      if (it.t === 'choice') {
        var ids = (it.opts || []).map(function (o) { return o.id; }), x = r(), want = x < 0.7 ? 'replaced' : x < 0.92 ? 'clean' : 'dirty';
        if (ids.length) res[it.id] = ids.indexOf(want) >= 0 ? want : ids[0];
        return;
      }
      var na = r();
      if (!it.req && ((asset && asset.refrigerant === 'R290' && /^h_(hp|lp)$/.test(it.id)) || na < 0.06)) { res[it.id] = 'na'; return; }
      var lo = it.lo == null || it.lo === '' ? 0 : +it.lo, hi = it.hi == null || it.hi === '' ? lo + 10 : +it.hi, sp = hi - lo, v;
      v = r() < 0.04 ? (r() < 0.5 ? lo - sp * (0.05 + 0.2 * r()) : hi + sp * (0.05 + 0.15 * r())) : lo + sp * (0.15 + 0.7 * r());
      if (it.id === 'g_co') v = r() < 0.04 ? 105 + Math.floor(r() * 56) : 8 + Math.floor(r() * 68);
      if (it.id === 'i_vac') v = 0.4 + 3.1 * r();
      var dec = /^(bar|%|pH|kg|mbar)$/.test(it.unit) ? 1 : 0;
      res[it.id] = Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec);
    });
    return res;
  }

  // ── the generator ────────────────────────────────────────────────────────
  function generate(today, opts) {
    opts = opts || {};
    if (!E.isDate(today)) throw new Error('generate: today must be YYYY-MM-DD');
    var A = E.addDays, nowHM = demoClock(opts.now), NOW = today + 'T' + nowHM;
    var r = rng(0x5E471CE);
    var Y = +today.slice(0, 4);
    var holidays = [].concat(E.siHolidays(Y - 1), E.siHolidays(Y), E.siHolidays(Y + 1));
    var hmap = E.holidayMap(holidays), wd = function (d) { return E.isWorkday(d, hmap); };
    var histStart = A(today, -HISTORY_DAYS);
    var PART = {}; PARTS.forEach(function (p) { PART[p.id] = p; });
    var db = {
      version: VERSION, generatedFor: today, demoNow: NOW, touched: false, safePhones: 1,
      company: copy(COMPANY), office: copy(OFFICE),
      settings: { labourRate: 46, callout: 35, freeKm: 20, kmRate: 0.55, emergencyPct: 50, vat: 22, hoursPerDay: 8, farKm: 35, sla: { premium: 24, basic: 72, none: 120 }, holidays: holidays, footer: copy(FOOTER),
        payDays: 8, purposeCode: 'GDSV', planAuto: copy(E.PLAN_AUTO) },
      techs: [], customers: [], assets: [], parts: copy(PARTS), templates: makeTemplates(), jobs: [], log: [{ at: NOW, text: 'Demo data created.' }]
    };
    var TPL = db.templates, RATES = E.frozenRates(db.settings);
    TECHS.forEach(function (t) {
      db.techs.push({ id: t[0], name: t[1], phone: t[5], email: ascii(t[1].toLowerCase()).replace(/\s+/g, '.') + '@example.com', skills: t[2].slice(), base: t[3], colour: t[4], hours: 8, active: true, van: {} });
    });
    var TECH = {}; db.techs.forEach(function (t) { TECH[t.id] = t; });

    // ── customers: households, businesses and public bodies ──
    var nCust = opts.customers || N_CUSTOMERS, types = [], i;
    var nBiz = Math.round(nCust * 0.22), nPub = Math.round(nCust * 0.04);
    for (i = 0; i < nCust; i++) types.push(i < nBiz ? 'business' : i < nBiz + nPub ? 'public' : 'household');
    shuffle(types, r);
    var emails = {}, names = {};
    function person(inHr) {
      var hr = r() < 0.08 || !!inHr, male = r() < 0.5;
      return r.pick(hr ? (male ? HR_M : HR_F) : (male ? SL_M : SL_F)) + ' ' + r.pick(hr ? HR_S : SL_S);
    }
    function bizName(inHr) {
      for (var g = 0; g < 40; g++) {
        var t = r.pick(inHr ? HR_BIZ_TYPES : BIZ_TYPES), w = r() < 0.5 ? r.pick(inHr ? HR_S : SL_S) : r.pick(BIZ_WORDS), f = r() < 0.45 ? ' d.o.o.' : r() < 0.45 ? (inHr ? ' obrt' : ' s.p.') : '';
        var n = t + ' ' + w + f; if (!names[n]) { names[n] = 1; return n; }
      }
      return 'Podjetje ' + r.int(100, 999) + ' d.o.o.';
    }
    function pubName(town, inHr) {
      for (var g = 0; g < 40; g++) { var n = r.pick(inHr ? HR_PUBLIC_TYPES : PUBLIC_TYPES) + ' ' + r.pick(PUBLIC_WORDS) + ' ' + town; if (!names[n]) { names[n] = 1; return n; } }
      return 'Javni zavod ' + r.int(100, 999) + ' ' + town;
    }
    function d3() { return String(r.int(100, 999)); }
    // +386 1 000 … / +385 1 000 …: numbers no subscriber has (the random draws stay the same as before)
    function mobile(cc) { r.pick([0, 1, 2]); var a = d3(), b = d3(); return '+' + (cc || '386') + ' 1 000 ' + a.slice(1) + ' ' + b.slice(1); }
    function landline(cc) { d3(); return '+' + (cc || '386') + ' 1 000 ' + pad(r.int(10, 99)) + ' ' + pad(r.int(10, 99)); }
    function email(base, tld) { var b = ascii(base).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, ''), e = b, k = 2; while (emails[e]) e = b + (k++); emails[e] = 1; return e + '@example.' + (tld || 'com'); }
    var pickTown = weighted(TOWN_W), CUST = {};
    types.forEach(function (tp, k) {
      var town = pickTown(r), name, contact, role = '', hrc = E.countryOf({ city: town }) === 'HR', cc = hrc ? '385' : '386';
      if (tp === 'household') { name = person(hrc); contact = name; }
      else { name = tp === 'business' ? bizName(hrc) : pubName(town, hrc); contact = person(hrc); role = r.pick(ROLES); }
      var plan = pickW(tp === 'household' ? [['none', 45], ['basic', 36], ['premium', 19]] : tp === 'business' ? [['none', 30], ['basic', 32], ['premium', 38]] : [['basic', 50], ['premium', 50]], r);
      var accessT = tp === 'household' ? (r() < 0.45 ? r.pick(ACCESS) : '') : (r() < 0.7 ? r.pick(ACCESS_BIZ) : '');
      var c = {
        id: 'c' + pad(k + 1, 4), name: name, type: tp, contact: contact, role: role,
        phone: tp === 'household' ? mobile(cc) : (r() < 0.6 ? landline(cc) : mobile(cc)),
        email: email(tp === 'household' ? name : name.replace(/ d\.o\.o\.| s\.p\.| d\.d\.| obrt/g, ''), hrc ? 'hr' : 'com'),
        street: (hrc ? r.pick(HR_STREETS) : tp === 'household' ? r.pick(STREETS) : r.pick(BIZ_STREETS)) + ' ' + r.int(1, tp === 'household' ? 64 : 120) + (r() < 0.1 ? 'a' : ''),
        postal: E.postalOf(town), city: town,
        access: accessT.replace('{code}', String(r.int(1000, 9899))).replace('{no}', String(r.int(2, 48))),
        plan: plan, planSince: plan === 'none' ? '' : A(today, -r.int(60, 2200)), notes: ''
      };
      db.customers.push(c); CUST[c.id] = c;
    });

    // ── equipment ──
    var ASSET = {}, aSeq = 0;
    function kindFor(c, nth, first) {
      if (c.type === 'household') {
        if (!nth) return pickW([['hp', 40], ['gas', 38], ['ac', 14], ['vent', 5], ['solar', 3]], r);
        if (first === 'gas') return pickW([['solar', 30], ['ac', 60], ['vent', 10]], r);
        if (first === 'hp') return pickW([['ac', 50], ['vent', 40], ['solar', 10]], r);
        return pickW([['ac', 40], ['hp', 30], ['gas', 30]], r);
      }
      if (c.type === 'business') return pickW([['ac', 50], ['gas', 18], ['hp', 14], ['vent', 18]], r);
      return pickW([['gas', 34], ['hp', 26], ['vent', 26], ['ac', 14]], r);
    }
    /** fresh = installed in the last 9 months or planned: no models with the old R410A refrigerant */
    function addAsset(c, kind, installed, fresh) {
      var m = MODELS[kind][pickW(MODELS[kind].map(function (x, ix) { return [ix, fresh && x[2] === 'R410A' ? 0 : MODEL_W[kind][ix]]; }), r)];
      if (!fresh && m[2] === 'R410A' && installed > A(today, -6 * 365)) installed = E.workdayOnOrAfter(A(today, -r.int(6 * 365, 10 * 365)), hmap);
      var a = {
        id: 'a' + pad(++aSeq, 5), customerId: c.id, kind: kind, brand: m[0], model: m[1],
        serial: m[4] + installed.slice(2, 4) + '-' + pad(r.int(0, 9999999), 7),
        installed: installed, warrantyUntil: E.addMonths(installed, kind === 'hp' ? 60 : 24), lastService: '', interval: E.KIND[kind].interval,
        refrigerant: m[2], charge: m[3] ? round2(m[3] * (kind === 'ac' || /Split/.test(m[1]) ? r.between(1, 1.25) : 1)) : null,
        location: r.pick((LOC[c.type] || LOC.household)[kind]), _fail: m[5], _pre: ''
      };
      db.assets.push(a); ASSET[a.id] = a;
      return a;
    }
    var recentInstalls = [];
    db.customers.forEach(function (c) {
      var n = c.type === 'household' ? pickW([[1, 80], [2, 17], [3, 3]], r) : c.type === 'business' ? pickW([[1, 40], [2, 30], [3, 18], [4, 8], [6, 4]], r) : pickW([[2, 40], [3, 35], [4, 25]], r);
      var first = null;
      for (var k = 0; k < n; k++) {
        var kind = kindFor(c, k, first), fresh = r() < 0.03, installed;
        if (!k) first = kind;
        if (fresh) installed = E.workdayOnOrAfter(A(histStart, r.int(4, HISTORY_DAYS - 12)), hmap);
        else {
          var yrs = { gas: [1.5, 15], hp: [1, 8], ac: [1, 11], vent: [1.2, 9], solar: [3, 14] }[kind];
          installed = E.workdayOnOrAfter(A(today, -Math.round(r.between(yrs[0], yrs[1]) * 365)), hmap);
          if (installed >= A(histStart, -10)) installed = A(histStart, -r.int(10, 200));
        }
        var a = addAsset(c, kind, installed, fresh);
        if (a.installed >= histStart) recentInstalls.push(a);
      }
    });

    // ── when each asset is serviced (peaks before the heating season and before summer, spread for capacity) ──
    var SEASON = {
      heat: [6, 5, 6, 7, 7, 7, 7, 8, 12, 13, 13, 9], ac: [3, 3, 8, 15, 16, 15, 9, 6, 7, 6, 6, 6],
      vent: [4, 5, 13, 16, 15, 7, 5, 5, 8, 9, 8, 5], solar: [4, 4, 7, 12, 14, 14, 12, 10, 8, 6, 5, 4]
    };
    var seasonPick = {}; Object.keys(SEASON).forEach(function (k) { seasonPick[k] = weighted(SEASON[k].map(function (x, ix) { return [ix + 1, x]; })); });
    function anchorDate(kind, year) { return year + '-' + pad(seasonPick[kind === 'gas' || kind === 'hp' ? 'heat' : kind](r)) + '-' + pad(r.int(1, 28)); }
    var svcReq = [];
    db.assets.forEach(function (a) {
      // plan customers are serviced every interval (the plan books it); without a plan about 6 in 10 call each year
      var c = CUST[a.customerId], roll = r(), regular = c.plan !== 'none' ? true : roll < 0.62, iv = a.interval, happened = [];
      if (regular) {
        var anchor = anchorDate(a.kind, +a.installed.slice(0, 4));
        for (var g = 0; g < 80; g++) {
          var o = E.addMonths(anchor, iv * g);
          if (o < A(a.installed, 25)) continue;
          var d = E.workdayOnOrAfter(A(o, r.int(-6, 6)), hmap);
          if (d >= today) break;
          if (d >= A(today, -45) && r() < 0.08) break; // this year's service has not happened yet: overdue now
          happened.push(d);
        }
      } else if (a.installed < A(histStart, -30)) {
        var d0 = E.workdayOnOrAfter(A(today, -(r() < 0.75 ? r.int(40, 360) : r.int(370, 700))), hmap);
        if (d0 > A(a.installed, 30) && d0 < today) happened.push(d0);
      }
      happened.forEach(function (d) { if (d < histStart) a._pre = d; else svcReq.push({ asset: a, date: d }); });
      a.lastService = happened.length ? happened[happened.length - 1] : '';
    });

    // ── job helpers ──
    var tmp = 0;
    function underWarranty(a, d) { return !!(a.warrantyUntil && d <= a.warrantyUntil); }
    function mkJob(a, type, o) {
      var c = CUST[a.customerId], rep = o.reportedAt, pb = type === 'repair' ? (o.pb || r.pick(PROBLEMS[a.kind])) : null;
      var job = {
        _pb: pb,
        id: 'tmp' + (++tmp), no: '', customerId: c.id, assetId: a.id, type: type, priority: o.priority || 'normal', problem: o.problem || (pb ? pb[0] : problemFor(a, type)), source: o.source || 'phone',
        reportedAt: rep, createdAt: rep, preferredDate: o.preferredDate || '', status: 'new', date: '', window: '', span: E.defaultSpan(type, a.kind), techId: '',
        travelAt: '', arriveAt: '', finishAt: '', stage: '', checklist: { key: type + '|' + a.kind, res: {} }, notes: '', parts: [], labourMin: 0, km: 0,
        billing: E.defaultBilling(type, c.plan, underWarranty(a, E.dateOf(rep))), photos: [], signature: null, followUp: false, followUpOf: '', followUpId: '',
        visits: [], invoicedAt: '', cancelledAt: '', cancelReason: '', partsNote: '', log: []
      };
      job._dur = onsiteDuration(job, a);
      return job;
    }
    function officeTime(d) { return d + 'T' + pad(r.int(7, 15)) + ':' + pad(r.int(0, 59)); }
    function problemFor(a, type) {
      var m = a.brand + ' ' + a.model;
      if (type === 'service') return CUST[a.customerId].plan !== 'none' ? 'Annual service as per the service plan.' : 'Annual service, customer called.';
      if (type === 'install') return 'Install a new ' + m + ' as per the quote.';
      if (type === 'commission') return 'Commissioning of the new ' + m + '.';
      if (type === 'warranty') return 'Warranty inspection of the ' + m + '.';
      return r.pick(PROBLEMS[a.kind])[0];
    }
    var occ = {}, mins = {}; // 'date|techId' → [job or null] × 4 windows, and the minutes on site and on the road
    function est(job) { return (job._dur || 60) + 30; }
    function free(date, techId, w, span) { var o = occ[date + '|' + techId]; if (w + span > 4) return false; if (!o) return true; for (var x = w; x < w + span; x++) if (o[x]) return false; return true; }
    /** would the technician's day still end at a decent hour with this job in window w? (estimated driving, windows, earliest start) */
    function room(date, techId, job, w) {
      var o = occ[date + '|' + techId], town = TECH[techId].base, t = 445, n = 0, last = null;
      for (var x = 0; x < 4; x++) { // the day in window order, with the new job in window w (no arrays: this runs very often)
        var j = x === w ? job : o ? o[x] : null;
        if (!j || j === last) continue;
        last = j; n++;
        var c = CUST[j.customerId], km = E.distanceKm(town, c.city), arr = 485 + 120 * x;
        if (km == null) km = 25;
        if (t + 8.5 + Math.max(3, km) * 1.05 > arr) arr = t + 8.5 + Math.max(3, km) * 1.05;
        if (j._earliest && j._earliest.slice(0, 10) === date) { var e = +j._earliest.slice(11, 13) * 60 + +j._earliest.slice(14, 16); if (arr < e) arr = e; }
        t = arr + (j._dur || 60); town = c.city;
      }
      return t <= (n === 1 ? 1050 : 1010); // about 16:50, or 17:30 for a lone call-out
    }
    function book(job, date, techId, w) { var k = date + '|' + techId, o = occ[k] || (occ[k] = [null, null, null, null]); for (var x = w; x < w + job.span; x++) o[x] = job; mins[k] = (mins[k] || 0) + est(job); job.date = date; job.window = E.WINDOWS[w].id; job.techId = techId; }
    function unbook(job) { var k = job.date + '|' + job.techId, o = occ[k]; if (o) for (var x = 0; x < 4; x++) if (o[x] === job) o[x] = null; if (mins[k]) mins[k] -= est(job); job.date = ''; job.window = ''; job.techId = ''; }
    function dayList(date, techId) { var o = occ[date + '|' + techId] || [], out = []; o.forEach(function (j) { if (j && out.indexOf(j) < 0) out.push(j); }); return out; }
    function load(date, techId) { return (mins[date + '|' + techId] || 0) / 120; }
    /** technicians who can do the job: the one already working nearby that day (or living nearest) first, fuller days further back */
    function techOrder(job, d) {
      var a = ASSET[job.assetId], c = CUST[job.customerId], need = E.requiredSkills(a.kind, job.type);
      function near(t) {
        var best = E.distanceKm(t.base, c.city), o = occ[d + '|' + t.id]; if (best == null) best = 40;
        if (o) for (var x = 0; x < 4; x++) if (o[x]) { var k = E.distanceKm(CUST[o[x].customerId].city, c.city); if (k != null && k < best) best = k; }
        return best;
      }
      return db.techs.filter(function (t) { return need.every(function (s) { return t.skills.indexOf(s) >= 0; }); })
        .map(function (t) { return { t: t, k: near(t) + r() * 14 + 9 * load(d, t.id) }; }).sort(function (x, y) { return x.k - y.k; }).map(function (x) { return x.t; });
    }
    function winOrder(job) {
      if (job.span >= 4) return [0];
      if (job.span === 2) return r() < 0.6 ? [0, 2, 1] : [2, 0, 1];
      if (job.type === 'repair') return [0, 1, 2, 3];
      var x = r();
      return x < 0.3 ? [0, 1, 2, 3] : x < 0.55 ? [1, 0, 2, 3] : x < 0.8 ? [2, 1, 3, 0] : [3, 2, 1, 0];
    }
    function fitsEarliest(job, d, w) { return !job._earliest || E.stamp(d, E.WINDOWS[Math.min(3, w + job.span - 1)].end) > E.addMin(job._earliest, 40); }
    /** put a job on the first free technician and window of the candidate dates */
    function place(job, dates, opt) {
      opt = opt || {};
      for (var di = 0; di < dates.length; di++) {
        var d = dates[di], ws = opt.windows || winOrder(job), techs = opt.techs || techOrder(job, d);
        for (var ti = 0; ti < techs.length; ti++) for (var wi = 0; wi < ws.length; wi++) {
          var w = ws[wi];
          if (opt.skip && opt.skip(techs[ti], w)) continue;
          if (fitsEarliest(job, d, w) && free(d, techs[ti].id, w, job.span) && room(d, techs[ti].id, job, w)) { book(job, d, techs[ti].id, w); return true; }
        }
      }
      return false;
    }
    function workdaysFrom(d, n) { var out = []; for (var x = d; out.length < n; x = A(x, 1)) if (wd(x)) out.push(x); return out; }
    function onsiteDuration(job, a) {
      var k = a.kind;
      if (job.type === 'service') return r.int.apply(null, { gas: [60, 100], hp: [75, 130], ac: [45, 90], vent: [50, 95], solar: [60, 105] }[k]);
      if (job.type === 'repair') return Math.round(35 + r() * r() * 160 + r() * 20);
      if (job.type === 'install') return k === 'ac' ? r.int(160, 230) : r.int(330, 440);
      if (job.type === 'commission') return r.int(110, 190);
      return r.int(40, 80);
    }
    /** travel start, arrival and finish for one technician's day in window order: travel never starts before the
     * previous job is finished. `limit` caps finish times (the demo clock, for today). */
    function timeDay(list, techId, date, limit) {
      var t = TECH[techId], town = t.base, prevEnd = date + 'T07:25';
      list.sort(function (x, y) { return E.winIndex(x.window) - E.winIndex(y.window); });
      list.forEach(function (j) {
        var c = CUST[j.customerId], km1 = E.distanceKm(town, c.city); if (km1 == null) km1 = 25;
        var travel = 6 + Math.round(Math.max(3, km1) * 1.05 + r() * 5), w = E.winIndex(j.window); // about 60 km/h plus parking
        var arr = E.addMin(E.stamp(date, E.WINDOWS[w].start), -10 + Math.round(r() * 40));
        if (E.addMin(prevEnd, travel) > arr) arr = E.addMin(prevEnd, travel + r.int(0, 5));
        if (j._earliest && arr < j._earliest) arr = j._earliest;
        j.arriveAt = arr; j.travelAt = E.addMin(arr, -travel);
        j.finishAt = E.addMin(arr, j._dur || onsiteDuration(j, ASSET[j.assetId]));
        if (limit && j.finishAt > limit) j.finishAt = limit;
        prevEnd = j.finishAt; town = c.city;
      });
    }

    // ── what a finished job contains ──
    function partialChecklist(j, a, share) {
      var items = TPL[j.checklist.key].items, all = demoChecklist(items, r.int(1, 2147483646), a), res = {};
      items.slice(0, Math.ceil(items.length * share)).forEach(function (it) { if (all[it.id] != null) res[it.id] = all[it.id]; });
      return res;
    }
    function addPart(j, id, qty) {
      var p = PART[id]; if (!p || !(qty > 0)) return;
      var ex = j.parts.filter(function (x) { return x.partId === id; })[0];
      if (ex) ex.qty = round2(ex.qty + qty); else j.parts.push({ partId: id, qty: round2(qty), price: p.price, van: p.vanStd > 0 });
    }
    function fixFor(j, kind) { var keys = j._pb ? j._pb[2] : Object.keys(FIXES[kind]); return FIXES[kind][r.pick(keys)]; }
    /** a fix that needs a part vans do not carry, for jobs that wait for parts; null when the problem has none */
    function slowPartFix(j, kind) {
      var keys = (j._pb ? j._pb[2] : Object.keys(FIXES[kind])).filter(function (k) { var f = FIXES[kind][k]; return f[0] && PART[f[0]] && PART[f[0]].vanStd === 0; });
      return keys.length ? FIXES[kind][r.pick(keys)] : null;
    }
    function partsAndNotes(j, a) {
      var k = a.kind;
      if (j.type === 'service') {
        j.notes = r.pick(SERVICE_NOTES[k]);
        if (k === 'gas') { if (r() < 0.6) addPart(j, 'GN-SEA-01', 1); if (r() < 0.3) addPart(j, 'GB-FLG-60', 1); if (r() < 0.2) addPart(j, 'GB-NEU-01', 1); if (r() < 0.1) addPart(j, 'GB-ELC-01', 1); if (r() < 0.12) addPart(j, 'GN-INH-01', 1); }
        if (k === 'hp') { if (r() < 0.5) addPart(j, 'HP-MAG-01', 1); if (r() < 0.3) addPart(j, 'GN-INH-01', 1); if (r() < 0.1) addPart(j, 'HP-AAV-01', 1); if (r() < 0.08) addPart(j, 'HP-ANO-01', 1); }
        if (k === 'ac') { if (r() < 0.8) addPart(j, 'GN-DIS-01', 1); if (r() < 0.4) addPart(j, 'GN-CLN-01', 1); if (r() < 0.15) addPart(j, 'AC-FLT-01', 1); if (r() < 0.12) addPart(j, 'GN-BAT-01', 1); }
        if (k === 'vent' && j.checklist.res.v_filter === 'replaced') addPart(j, VENT_FILTER[a.model], 1);
        if (k === 'solar' && r() < 0.4) addPart(j, 'SL-FLD-10', 1);
      } else if (j.type === 'repair') {
        var fix = j._fix || fixFor(j, k);
        j.notes = fix[1];
        if (fix[0] === 'RF-R32') addPart(j, a.refrigerant === 'R410A' ? 'RF-R410A' : 'RF-R32', round2(r.between(0.2, 0.6)));
        else if (fix[0]) addPart(j, fix[0], 1);
        if (r() < 0.4) addPart(j, 'GN-SEA-01', 1);
      } else if (j.type === 'install') {
        j.notes = r.pick(OTHER_NOTES.install);
        if (k === 'ac') { addPart(j, 'GN-CU14', r.int(3, 7)); addPart(j, 'GN-CU38', r.int(3, 7)); addPart(j, 'GN-INS-01', r.int(6, 14)); addPart(j, 'GN-CBL-01', r.int(5, 12)); addPart(j, 'GN-BRK-01', 1); addPart(j, 'GN-CDH-01', r.int(3, 6)); }
        else if (k === 'hp') { addPart(j, 'GN-FIT-01', 2); addPart(j, 'GN-BLV-34', 2); addPart(j, 'GN-INH-01', 2); addPart(j, 'GN-CBL-01', r.int(8, 15)); addPart(j, 'GN-DMP-01', 1); addPart(j, 'HP-SV3-01', 1); }
        else if (k === 'gas') { addPart(j, 'GN-FIT-01', 1); addPart(j, 'GB-FLG-60', 2); addPart(j, 'GN-BLV-34', 2); addPart(j, 'GN-INH-01', 1); }
        else if (k === 'vent') { addPart(j, 'GN-FIT-01', 1); addPart(j, 'GN-CDH-01', 2); }
        else { addPart(j, 'SL-FLD-10', 2); addPart(j, 'GN-FIT-01', 1); addPart(j, 'GN-INS-01', 10); }
      } else if (j.type === 'commission') { j.notes = r.pick(OTHER_NOTES.commission); if (r() < 0.5 && (k === 'hp' || k === 'gas' || k === 'solar')) addPart(j, 'GN-INH-01', 1); }
      else j.notes = r.pick(OTHER_NOTES.warranty);
    }
    function sign(j) {
      var c = CUST[j.customerId];
      if (r() < 0.02) { j.signature = { none: true, reason: c.type === 'household' ? 'Nobody at home; key with the neighbour. Report sent by e-mail.' : 'Caretaker not available; report sent by e-mail.', at: j.finishAt }; return; }
      j.signature = { name: c.contact, at: E.addMin(j.finishAt, r.int(2, 6)), demo: true };
    }
    function finish(j) {
      var a = ASSET[j.assetId], c = CUST[j.customerId], t = TECH[j.techId];
      j.checklist.seed = r.int(1, 2147483646);
      j.checklist.res = demoChecklist(TPL[j.checklist.key].items, j.checklist.seed, a);
      partsAndNotes(j, a);
      j.labourMin = E.onsiteMinutes(j);
      j.km = (E.tripKm(t.base, c.city) + r.int(0, 4)) * (1 + j.visits.length);
      j.status = 'done';
      j.rates = RATES;
      sign(j);
    }
    function visitRecord(v, note) { return { techId: v.techId, date: v.date, window: v.window, travelAt: v.travelAt, arriveAt: v.arriveAt, leftAt: v.finishAt, note: note }; }

    // ── the last 9 months: services, installations, commissioning, repairs, warranty checks ──
    var hist = [], futureCommission = [];
    svcReq.forEach(function (s) {
      var j = mkJob(s.asset, 'service', { reportedAt: officeTime(A(s.date, -r.int(6, 24))), source: CUST[s.asset.customerId].plan !== 'none' ? 'plan' : 'phone' });
      j._want = s.date; j._plan = CUST[s.asset.customerId].plan !== 'none'; hist.push(j);
    });
    recentInstalls.forEach(function (a) {
      var j = mkJob(a, 'install', { reportedAt: officeTime(A(a.installed, -r.int(12, 40))), source: 'quote' });
      j._want = a.installed; j._fixedDate = true; hist.push(j);
      if (a.kind === 'hp' || (a.kind === 'vent' && r() < 0.5)) {
        var cd = E.workdayOnOrAfter(A(a.installed, r.int(3, 10)), hmap), cj = mkJob(a, 'commission', { reportedAt: j.reportedAt, source: 'quote' });
        cj._want = cd; cj._after = j;
        if (cd < today) hist.push(cj); else futureCommission.push(cj);
      }
    });
    // repairs follow the weather: cold months for heating, hot ones for cooling, a few cold snaps; weekends are quieter
    var heatM = [2.4, 2.2, 1.4, 0.8, 0.5, 0.4, 0.4, 0.4, 0.7, 1.1, 1.5, 2.1], coolM = [0.2, 0.2, 0.3, 0.5, 0.9, 1.8, 2.6, 2.0, 0.9, 0.4, 0.2, 0.2], snaps = [];
    for (var sd = histStart; sd < today; sd = A(sd, 7)) { var mo = +sd.slice(5, 7); if ((mo === 1 || mo === 2 || mo === 12) && r() < 0.3) snaps.push(sd); }
    function dayWeight(d, kind) {
      var m = +d.slice(5, 7) - 1, w = kind === 'ac' ? coolM[m] : kind === 'vent' ? 0.8 : heatM[m];
      if (kind !== 'ac' && kind !== 'vent' && snaps.some(function (s) { return d >= s && d < A(s, 7); })) w *= 2.2;
      return w * (E.isWeekend(d) ? 0.35 : 1);
    }
    var days = []; for (var dd = histStart; dd < today; dd = A(dd, 1)) days.push(dd);
    var dayPick = {}; E.KINDS.forEach(function (k) { dayPick[k.id] = weighted(days.map(function (d) { return [d, dayWeight(d, k.id)]; })); });
    var assetPick = weighted(db.assets.map(function (a) { var age = Math.max(0, E.diffDays(a.installed, today) / 365); return [a, ({ gas: 1.15, hp: 1, ac: 0.85, vent: 0.5, solar: 0.4 })[a.kind] * (0.55 + 0.45 * a._fail) * (1 + Math.min(age, 12) / 24)]; }));
    var svcOn = {}; svcReq.forEach(function (s) { (svcOn[s.asset.id] = svcOn[s.asset.id] || []).push(s.date); });
    var repOn = {}, nRepairs = Math.round(db.assets.length * 0.26);
    for (var made = 0, guard = 0; made < nRepairs && guard < nRepairs * 8; guard++) {
      var ra = assetPick(r), rd = dayPick[ra.kind](r);
      if (ra.installed > A(rd, -10)) continue;
      // a fresh service usually catches problems; repeats on the same unit are rare
      if ((svcOn[ra.id] || []).some(function (s) { return s < rd && s >= A(rd, -30); }) && r() < 0.8) continue;
      if ((repOn[ra.id] || []).length >= 2 || ((repOn[ra.id] || []).some(function (s) { return s > A(rd, -45) && s < A(rd, 45); }) && r() < 0.85)) continue;
      (repOn[ra.id] = repOn[ra.id] || []).push(rd);
      var pb = r.pick(PROBLEMS[ra.kind]), mo2 = +rd.slice(5, 7), rc = CUST[ra.customerId];
      var cold = (ra.kind === 'gas' || ra.kind === 'hp') && (mo2 <= 3 || mo2 >= 11), hot = ra.kind === 'ac' && mo2 >= 6 && mo2 <= 8;
      var priority = pb[1] && (cold ? r() < 0.45 : hot && rc.type !== 'household' ? r() < 0.3 : false) ? 'emergency' : r() < 0.22 ? 'high' : 'normal';
      var rj = mkJob(ra, 'repair', { reportedAt: rd + 'T' + pad(r.int(6, 19)) + ':' + pad(r.int(0, 59)), priority: priority, pb: pb, source: pickW([['phone', 70], ['email', 20], ['web form', 10]], r) });
      rj._multi = r() < 0.06;
      hist.push(rj); made++;
    }
    var nWarranty = Math.round(db.assets.length * 0.01);
    db.assets.filter(function (a) { return a.installed < A(histStart, -60) && a.warrantyUntil > A(today, 20); }).filter(function () { return r() < 0.4; }).slice(0, nWarranty).forEach(function (a) {
      var d = E.workdayOnOrAfter(A(histStart, r.int(5, HISTORY_DAYS - 10)), hmap);
      var j = mkJob(a, 'warranty', { reportedAt: officeTime(A(d, -r.int(5, 20))), source: 'phone' });
      j._want = d; hist.push(j);
    });

    // waiting for parts: the first visit (yesterday or a few working days ago) found the fault, the part is on order
    var openAsset = {}, waiting = [], busy = {};
    hist.forEach(function (j) { if ((j._want || j.reportedAt.slice(0, 10)) >= A(today, -25)) busy[j.assetId] = 1; });
    for (var wq = 0; wq < 3; wq++) {
      var cand = db.assets.filter(function (a) { return !openAsset[a.id] && !busy[a.id] && (a.kind === 'gas' || a.kind === 'hp' || a.kind === 'ac') && a.installed < A(today, -400); });
      var pa = cand[Math.floor(r() * cand.length)]; if (!pa) break; openAsset[pa.id] = 1;
      var vd = E.prevWorkday(today, hmap); for (var b = 0; b < wq * 2; b++) vd = E.prevWorkday(vd, hmap);
      var slowPbs = PROBLEMS[pa.kind].filter(function (p) { return p[2].some(function (k) { var f = FIXES[pa.kind][k]; return f[0] && PART[f[0]] && PART[f[0]].vanStd === 0; }); });
      var pj = mkJob(pa, 'repair', { reportedAt: A(vd, -1) + 'T' + pad(r.int(13, 17)) + ':' + pad(r.int(0, 59)), source: 'phone', pb: slowPbs.length ? r.pick(slowPbs) : null }); // reported the afternoon before
      var fx = slowPartFix(pj, pa.kind), visit = { id: 'w' + wq, span: 1, customerId: pj.customerId, assetId: pj.assetId, type: 'repair', _dur: r.int(35, 70) };
      if (!fx || !place(visit, [vd], { windows: [0, 1] })) { openAsset[pa.id] = 0; continue; }
      pj._visit = visit; pj._fix = fx; waiting.push(pj);
    }
    // book the rest in time order: installations first (fixed dates), then repairs (they have an SLA) and their
    // follow-ups, then annual services and warranty checks, which can move a few days. A few jobs are cancelled.
    hist.forEach(function (j) { j._sort = j._want || j.reportedAt.slice(0, 10); j._pass = j.type === 'install' || j.type === 'commission' ? 0 : j.type === 'repair' ? 1 : 2; });
    hist.sort(function (x, y) { return (x._pass - y._pass) || (x._sort < y._sort ? -1 : x._sort > y._sort ? 1 : (x.reportedAt < y.reportedAt ? -1 : x.reportedAt > y.reportedAt ? 1 : 0)); });
    var done = [], cancelled = [];
    function placeHist(j) {
      if (j.reportedAt < histStart + 'T06:00') j.reportedAt = j.createdAt = histStart + 'T06:' + pad(r.int(0, 59));
      if (j.type !== 'install' && j.type !== 'commission' && r() < (j._pass === 2 ? 0.012 : 0.03)) { cancelled.push(j); return; }
      var dates = [];
      if (j.type === 'repair') {
        var c = CUST[j.customerId], due = E.slaDue(j, c.plan, db.settings), late = r() < 0.05, lead = j.priority === 'emergency' ? 40 : c.plan === 'premium' ? 60 : 150;
        j._earliest = E.addMin(j.reportedAt, lead);
        var first = E.dateOf(j._earliest), lastOk = E.dateOf(late ? E.addMin(due, r.int(600, 2400)) : due);
        for (var x = late ? E.dateOf(due) : first; x <= lastOk; x = A(x, 1)) if (wd(x) || (j.priority === 'emergency' && x === first)) dates.push(x);
        dates = dates.concat(workdaysFrom(A(lastOk, 1), 5));
      } else {
        dates = [j._want].concat(workdaysFrom(A(j._want, 1), j._plan ? 25 : 12));
        if (!j._fixedDate) dates = dates.concat(workdaysFrom(A(j._want, -6), 6));
      }
      var repDay = E.dateOf(j.reportedAt); // a visit is never before the day it was asked for (repairs: _earliest handles the hour)
      dates = dates.filter(function (x) { return x < today && x >= histStart && (!j._after || x > j._after.date) && (j.type === 'repair' || x > repDay); });
      if (j._multi) { // the first visit finds the fault, a second one fixes it once the part is in
        var v = { id: 'v' + j.id, span: 1, customerId: j.customerId, assetId: j.assetId, type: 'repair', _earliest: j._earliest, _dur: r.int(30, 65) };
        var slow = slowPartFix(j, ASSET[j.assetId].kind);
        if (slow && place(v, dates.slice(0, 4), { windows: [0, 1, 2, 3] })) {
          j._visit = v; j._fix = slow; j._earliest = null;
          dates = workdaysFrom(A(v.date, r.int(3, 7)), 8).filter(function (x) { return x < today; });
        }
      }
      if (!dates.length || !place(j, dates)) {
        if (j._visit) unbook(j._visit);
        j._visit = null;
        if (j._pass < 2) cancelled.push(j); // a service that did not fit simply did not happen this time
        return;
      }
      if (j.type === 'install') { var ia = ASSET[j.assetId]; ia.installed = j.date; ia.warrantyUntil = E.addMonths(j.date, ia.kind === 'hp' ? 60 : 24); }
      done.push(j);
    }
    hist.forEach(function (j) { if (j._pass < 2) placeHist(j); });
    // some repairs come back within a few weeks (not first-time fixes)
    var followUps = [];
    done.filter(function (j) { return j.type === 'repair'; }).forEach(function (j) {
      if (r() >= 0.09) return;
      var back = A(j.date, r.int(3, 24));
      if (back >= A(today, -1)) return;
      var f = mkJob(ASSET[j.assetId], 'repair', { reportedAt: back + 'T' + pad(r.int(7, 16)) + ':' + pad(r.int(0, 59)), priority: 'high', source: 'phone', pb: j._pb,
        problem: 'Follow-up to {no}: ' + r.pick(['the same fault came back.', 'the error shows again.', 'the customer says the noise is back.']) });
      f._earliest = E.addMin(f.reportedAt, 60);
      var ds = workdaysFrom(E.dateOf(f._earliest), 6).filter(function (x) { return x < today; });
      if (!ds.length || !place(f, ds)) return;
      f.followUpOf = j.id; j.followUpId = f.id; j.followUp = true;
      followUps.push(f);
    });
    hist.forEach(function (j) { if (j._pass === 2) placeHist(j); });
    // time every technician's day, then finish the jobs
    Object.keys(occ).forEach(function (k) { var p = k.split('|'); timeDay(dayList(p[0], p[1]), p[1], p[0]); });
    done.concat(followUps).forEach(function (j) {
      if (j._visit) j.visits.push(visitRecord(j._visit, 'Fault found' + (j._fix ? ': ' + PART[j._fix[0]].name.toLowerCase() + ' faulty' : '') + '. Part ordered from Nordvik Distribucija.'));
      finish(j);
    });
    done = done.concat(followUps);
    waiting.forEach(function (pj, ix) {
      var visit = pj._visit, fx = pj._fix;
      pj.visits.push(visitRecord(visit, 'Fault found: ' + PART[fx[0]].name.toLowerCase() + ' faulty. Part ordered from Nordvik Distribucija.'));
      pj.techId = visit.techId; pj.status = 'parts'; pj.labourMin = E.onsiteMinutes(pj); pj.km = E.tripKm(TECH[visit.techId].base, CUST[pj.customerId].city);
      pj.checklist.res = { r_fault: 'pass', r_code: 'pass', r_cause: 'pass' };
      pj.partsNote = PART[fx[0]].name + ' (' + fx[0] + ') ordered from Nordvik Distribucija, expected ' + E.fmtDate(E.nextWorkday(A(today, ix), hmap)) + '.';
    });
    cancelled.forEach(function (j) {
      j.status = 'cancelled'; j.date = ''; j.window = ''; j.techId = ''; j.visits = [];
      j.cancelledAt = E.addMin(j.reportedAt, r.int(60, 2880)); if (j.cancelledAt > NOW) j.cancelledAt = NOW;
      j.cancelReason = r.pick(CANCEL);
    });
    // invoicing: everything older than a week is invoiced, the last week only partly
    done.forEach(function (j) {
      var fd = E.dateOf(j.finishAt), age = E.diffDays(fd, today);
      if (!(age > 40 ? true : age > 7 ? r() > 0.06 : r() < 0.3)) return;
      var at = A(fd, r.int(1, Math.max(1, Math.min(9, age - 1))));
      if (at >= today) at = A(today, -1);
      if (at < fd) at = fd;
      j.status = 'invoiced'; j.invoicedAt = at;
    });

    // ── today: a busy day with some free windows; Ana is on site, Tomislav on the road ──
    var cur = Math.max(1, Math.min(3, E.windowAt(nowHM))), todayWork = wd(today), next = [];
    for (var nd = A(today, 1); next.length < 4; nd = A(nd, 1)) if (wd(nd)) next.push(nd);
    function freeAsset(pred) {
      for (var g = 0; g < 400; g++) { var a = db.assets[Math.floor(r() * db.assets.length)]; if (!openAsset[a.id] && a.installed <= A(today, -20) && (!pred || pred(a))) { openAsset[a.id] = 1; return a; } }
      var list = db.assets.filter(function (a) { return !openAsset[a.id] && a.installed <= A(today, -20) && (!pred || pred(a)); });
      if (!list.length) return null;
      var b2 = list[Math.floor(r() * list.length)]; openAsset[b2.id] = 1; return b2;
    }
    var dueList = db.assets.filter(function (a) { var d = E.nextDue(a); a._due = d; return a.installed <= A(today, -40) && d && d <= A(today, 40); })
      .sort(function (x, y) { return (E.PLAN_RANK[CUST[x.customerId].plan] - E.PLAN_RANK[CUST[y.customerId].plan]) || (x._due < y._due ? -1 : x._due > y._due ? 1 : 0); });
    function dueAsset(maxDays, pred) {
      var lim = A(today, maxDays), list = dueList.filter(function (a) { return !openAsset[a.id] && a._due <= lim && (!pred || pred(a)); });
      list = list.slice(0, Math.max(1, Math.ceil(list.length * 0.6)));
      if (!list.length) return null;
      var a = list[Math.floor(r() * list.length)]; openAsset[a.id] = 1; return a;
    }
    function canDo(t, pred) { return function (a) { return E.missingSkills(t, a.kind, 'repair').length === 0 && (!pred || pred(a)); }; }
    function near(t, km) { return function (a) { var d = E.distanceKm(t.base, CUST[a.customerId].city); return d != null && d <= km; }; }
    function recentRepair(a, hoursAgo, priority) { return mkJob(a, 'repair', { reportedAt: E.addMin(NOW, -Math.round(hoursAgo * 60)), priority: priority || 'normal', source: r() < 0.75 ? 'phone' : 'email' }); }
    function serviceJob(a, daysAgo) {
      var j = mkJob(a, 'service', { reportedAt: officeTime(A(today, -daysAgo)), source: CUST[a.customerId].plan !== 'none' ? 'plan' : 'phone' });
      if (j.reportedAt > NOW) j.reportedAt = j.createdAt = E.addMin(NOW, -95);
      return j;
    }
    var heating = function (a) { return a.kind === 'gas' || a.kind === 'hp'; };
    /** hours ago a repair was reported so that a visit on `day` still meets the customer's SLA */
    function inSla(a, day) {
      var slaH = db.settings.sla[CUST[a.customerId].plan] || 120, until = Math.max(0, E.minutesBetween(NOW, day + 'T16:00') / 60);
      return Math.round(r.between(2, Math.max(2.5, Math.min(48, slaH - until - 1))) * 10) / 10;
    }
    var techA = TECH.t2, techB = TECH.t4;
    var jA = recentRepair(freeAsset(canDo(techA, function (a) { return CUST[a.customerId].plan !== 'none' && near(techA, 20)(a); })) || freeAsset(canDo(techA)), 20, todayWork ? 'high' : 'emergency');
    var jB = recentRepair(freeAsset(canDo(techB, function (a) { return heating(a) && near(techB, 30)(a); })) || freeAsset(canDo(techB)), 4.5, todayWork ? 'normal' : 'emergency');
    jA._dur = jB._dur = 60; // still under way: only used to judge how full their day is
    book(jA, today, techA.id, cur); book(jB, today, techB.id, cur);
    var current = [], todayJobs = [jA, jB];
    /** fill a technician's free windows on a day with jobs that suit them */
    function fillDay(d, t, share, skipW, allowRepairs) {
      var di = next.indexOf(d);
      for (var w = 0; w < 4; w++) {
        if (w === skipW || !free(d, t.id, w, 1) || r() > share) continue;
        var roll = r(), a, j;
        if (roll < 0.66 || !allowRepairs) { a = dueAsset(30, canDo(t, near(t, 40))); if (!a) continue; j = serviceJob(a, r.int(2, 20)); }
        else if (roll < 0.95) {
          a = freeAsset(canDo(t, function (x) { var pl = CUST[x.customerId].plan; return x.kind !== 'solar' && near(t, 40)(x) && (d === today || (E.diffDays(today, d) > 1 ? pl === 'none' : pl !== 'premium')); }));
          if (!a) continue;
          var hrs = inSla(a, d);
          if (d === today && w < cur) hrs = Math.max(hrs, E.minutesBetween(E.stamp(today, E.WINDOWS[w].start), NOW) / 60 + r.between(1, 12)); // reported before the visit
          j = recentRepair(a, hrs, r() < 0.25 ? 'high' : 'normal');
        }
        else { a = freeAsset(canDo(t, function (x) { return x.warrantyUntil > A(today, 30) && x.installed < A(today, -150) && near(t, 40)(x); })); if (!a) continue; j = mkJob(a, 'warranty', { reportedAt: officeTime(A(today, -r.int(4, 20))), source: 'phone' }); }
        var due = j.type === 'repair' ? E.slaDue(j, CUST[j.customerId].plan, db.settings) : '';
        if (!free(d, t.id, w, j.span) || !room(d, t.id, j, w) || (due && due < E.stamp(d, E.WINDOWS[Math.min(3, w + j.span - 1)].end))) { openAsset[a.id] = 0; continue; }
        book(j, d, t.id, w);
        (d === today ? todayJobs : current).push(j);
      }
    }
    if (todayWork) db.techs.forEach(function (t) { fillDay(today, t, 0.82, cur, true); });
    else {
      var ea = freeAsset(canDo(techA, heating));
      if (ea) { var early = recentRepair(ea, 9, 'emergency'); if (place(early, [today], { techs: [techA], windows: [0, 1, 2].filter(function (w) { return w < cur; }) })) todayJobs.push(early); }
    }
    // done before now; Ana arrived about half an hour ago; Tomislav left about ten minutes ago
    db.techs.forEach(function (t) {
      var before = todayJobs.filter(function (j) { return j.techId === t.id && j !== jA && j !== jB && E.winIndex(j.window) < cur; });
      var limit = t.id === techA.id ? E.addMin(NOW, -76) : t.id === techB.id ? E.addMin(NOW, -20) : E.addMin(NOW, -6);
      timeDay(before, t.id, today, limit);
      before.forEach(function (j) { if (E.minutesBetween(j.arriveAt, j.finishAt) < 20) { unbook(j); openAsset[j.assetId] = 0; todayJobs.splice(todayJobs.indexOf(j), 1); } });
    });
    jA.status = 'onsite'; jA.stage = 'work';
    jA.arriveAt = E.addMin(NOW, -r.int(24, 36)); jA.travelAt = E.addMin(jA.arriveAt, -r.int(14, 24));
    jA.checklist.res = partialChecklist(jA, ASSET[jA.assetId], 0.3);
    jA.notes = 'Error log read. Checking the sensors next.';
    jB.status = 'travelling'; jB.travelAt = E.addMin(NOW, -r.int(7, 13));
    todayJobs.forEach(function (j) {
      if (j === jA || j === jB) return;
      if (E.winIndex(j.window) < cur) finish(j); else j.status = 'scheduled';
    });
    current = current.concat(todayJobs);

    // ── the next four working days, fuller first; two installations and the pending commissioning ──
    futureCommission.forEach(function (cj) {
      var ds = next.filter(function (x) { return x > cj._after.date; }).slice(0, 3);
      openAsset[cj.assetId] = 1;
      if (ds.length && place(cj, ds)) cj.status = 'scheduled'; else { cj.status = 'new'; cj.preferredDate = ds[0] || next[0]; }
      current.push(cj);
    });
    [1, 2].forEach(function (di) {
      var d = next[di], c = db.customers[Math.floor(r() * db.customers.length)], kind = c.type === 'household' ? (r() < 0.6 ? 'hp' : 'ac') : 'ac';
      if (c.type === 'public') c = db.customers.filter(function (x) { return x.type === 'household'; })[0];
      var na = addAsset(c, kind, d, true); openAsset[na.id] = 1;
      var j = mkJob(na, 'install', { reportedAt: officeTime(A(today, -r.int(14, 35))), source: 'quote' });
      if (place(j, [d])) { j.status = 'scheduled'; current.push(j); } else { db.assets.splice(db.assets.indexOf(na), 1); delete ASSET[na.id]; }
    });
    [0.78, 0.6, 0.42, 0.25].forEach(function (share, di) { db.techs.forEach(function (t) { fillDay(next[di], t, share, -1, di < 2); }); });
    current.forEach(function (j) { if (j.status === 'new' && j.date) j.status = 'scheduled'; });

    // ── the queue: new jobs nobody has planned yet, two of them emergencies ──
    var queue = [];
    var e1 = recentRepair(freeAsset(function (a) { return a.kind === 'gas' && CUST[a.customerId].plan === 'premium' && CUST[a.customerId].type === 'household'; }) || freeAsset(function (a) { return a.kind === 'gas'; }),
      Math.min(3.3, E.minutesBetween(today + 'T07:20', NOW) / 60), 'emergency');
    e1.problem = 'No heating and no hot water, boiler shows error F28. Elderly customer at home.';
    var e2 = recentRepair(freeAsset(function (a) { return a.kind === 'ac' && /Server/.test(a.location); }) || freeAsset(function (a) { return a.kind === 'ac' && CUST[a.customerId].type !== 'household'; }), 1.4, 'emergency');
    e2.problem = 'Air conditioner in the server room stopped cooling, room at 31 °C.';
    var h1 = recentRepair(freeAsset(function (a) { return a.kind === 'hp' && CUST[a.customerId].plan === 'basic'; }) || freeAsset(heating), 69, 'high');
    var o1 = recentRepair(freeAsset(function (a) { return CUST[a.customerId].plan === 'none' && a.kind !== 'solar'; }) || freeAsset(), 6 * 24 + 2, 'normal');
    var n1 = recentRepair(freeAsset(function (a) { return a.kind === 'vent'; }) || freeAsset(), 18.5, 'normal');
    queue.push(e1, e2, h1, o1, n1);
    for (var sq = 0; sq < 3; sq++) { var qs = dueAsset(40); if (!qs) break; var sj = serviceJob(qs, r.int(0, 3)); sj.preferredDate = next[Math.min(3, sq + 1)]; queue.push(sj); }
    queue.forEach(function (j) { j.status = 'new'; });
    current = current.concat(queue, waiting);

    // ── numbers in the order the jobs were created, real ids, links ──
    var all = done.concat(cancelled, current);
    all.sort(function (x, y) { return x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : 0; });
    var seq = {}, firstYear = +histStart.slice(0, 4), idMap = {}, byId = {};
    all.forEach(function (j, ix) {
      var yr = +j.createdAt.slice(0, 4);
      if (seq[yr] == null) seq[yr] = yr === firstYear ? Math.round(E.diffDays(firstYear + '-01-01', histStart) * 23) : 0;
      seq[yr]++;
      idMap[j.id] = 'j' + pad(ix + 1, 5); j.id = idMap[j.id]; j.no = E.jobNo(yr, seq[yr]); byId[j.id] = j;
    });
    all.forEach(function (j) {
      if (j.followUpOf) j.followUpOf = idMap[j.followUpOf] || '';
      if (j.followUpId) j.followUpId = idMap[j.followUpId] || '';
      if (j.followUpOf && byId[j.followUpOf]) j.problem = j.problem.replace('{no}', byId[j.followUpOf].no);
      Object.keys(j).forEach(function (k) { if (k.charAt(0) === '_') delete j[k]; });
    });
    db.jobs = all;
    // last service = the latest finished annual service, or the one before the history starts
    var lastSvc = {};
    all.forEach(function (j) { if (j.type === 'service' && E.isDone(j)) { var fd = E.dateOf(j.finishAt); if (!lastSvc[j.assetId] || fd > lastSvc[j.assetId]) lastSvc[j.assetId] = fd; } });
    db.assets.forEach(function (a) {
      var last = a._pre || '';
      if (lastSvc[a.id] && lastSvc[a.id] > last) last = lastSvc[a.id];
      a.lastService = last;
      Object.keys(a).forEach(function (k) { if (k.charAt(0) === '_') delete a[k]; });
    });
    // two pictures the app draws (no real photos in the demo)
    var pics = all.filter(function (j) { return E.isDone(j) && j.type === 'repair' && ASSET[j.assetId].kind === 'hp'; });
    if (pics.length) pics[pics.length - 1].photos.push({ id: 'ph1', demo: 'hp-ice', caption: 'Outdoor unit iced up before the repair' });
    pics = all.filter(function (j) { return E.isDone(j) && j.type === 'service' && ASSET[j.assetId].kind === 'gas'; });
    if (pics.length) pics[pics.length - 1].photos.push({ id: 'ph2', demo: 'boiler', caption: 'Burner after cleaning' });
    // van stock: standard quantities minus what has been used since the last restock
    db.techs.forEach(function (t) {
      var kinds = {}; t.skills.forEach(function (s) { if (s === 'hp') { kinds.hp = 1; kinds.solar = 1; } else if (s !== 'el') kinds[s] = 1; });
      PARTS.forEach(function (p) {
        if (!p.vanStd || (p.kinds.length && !p.kinds.some(function (k) { return kinds[k]; }))) return;
        t.van[p.id] = r() < 0.16 ? r.int(0, Math.max(0, p.vanMin - 1)) : r.int(Math.max(p.vanMin, Math.ceil(p.vanStd / 2)), p.vanStd);
      });
    });
    // service plans: the visits that are due are booked automatically, as the app does every day it is opened
    var auto = addPlanVisits(db, E.planVisits(db, today, { hmap: hmap }), NOW);
    // two customers asked to move their overdue visit: the office cancelled it, so the equipment shows as overdue and
    // the automatic booking leaves it alone (a person decided)
    auto.filter(function (j) { return j.planDue < today && j.status === 'scheduled'; }).filter(function (j, ix) { return ix % 37 === 5; }).slice(0, 2).forEach(function (j) {
      j.log.push({ at: NOW, by: OFFICE.name, text: 'Cancelled: ' + CANCEL[2] });
      j.status = 'cancelled'; j.cancelledAt = NOW; j.cancelReason = CANCEL[2]; j.techId = ''; j.date = ''; j.window = '';
    });
    return db;
  }

  /** add the jobs for automatic plan visits (E.planVisits) to db, numbered after the highest number of the year */
  function addPlanVisits(db, visits, now) {
    var cust = {}, asset = {}, out = [];
    db.customers.forEach(function (c) { cust[c.id] = c; });
    db.assets.forEach(function (a) { asset[a.id] = a; });
    visits.forEach(function (v) {
      var a = asset[v.assetId], c = cust[v.customerId]; if (!a || !c) return;
      var j = E.planJob(v, a, c, now, E.nextJobNo(db.jobs, +now.slice(0, 4)));
      db.jobs.push(j); out.push(j);
    });
    return out;
  }

  // ── compact storage: what IndexedDB and the cloud copy hold ─────────────
  // Short keys, defaults left out, fixed demo texts stored by number, checklist answers of finished demo jobs rebuilt
  // from their seed, demo signatures drawn from the name, shared rate sets. unpack(pack(db)) gives db back.
  var TEXTS = (function () {
    var t = ['Annual service as per the service plan.', 'Annual service, customer called.', 'Annual service.', 'Error log read. Checking the sensors next.'];
    Object.keys(PROBLEMS).forEach(function (k) { PROBLEMS[k].forEach(function (p) { t.push(p[0]); }); });
    Object.keys(FIXES).forEach(function (k) { Object.keys(FIXES[k]).forEach(function (f) { t.push(FIXES[k][f][1]); }); });
    Object.keys(SERVICE_NOTES).forEach(function (k) { SERVICE_NOTES[k].forEach(function (x) { t.push(x); }); });
    Object.keys(OTHER_NOTES).forEach(function (k) { OTHER_NOTES[k].forEach(function (x) { t.push(x); }); });
    CANCEL.forEach(function (x) { t.push(x); });
    Object.keys(LOC).forEach(function (g) { Object.keys(LOC[g]).forEach(function (k) { LOC[g][k].forEach(function (x) { t.push(x); }); }); });
    Object.keys(MODELS).forEach(function (k) { MODELS[k].forEach(function (m) { var n = m[0] + ' ' + m[1]; t.push('Install a new ' + n + ' as per the quote.', 'Commissioning of the new ' + n + '.', 'Warranty inspection of the ' + n + '.'); }); });
    return t;
  })();
  var TIX = {}; TEXTS.forEach(function (s, ix) { if (TIX[s] == null) TIX[s] = ix; });
  function packText(s) { if (typeof s !== 'string' || !s) return s; if (TIX[s] != null) return '§' + TIX[s]; return s.charAt(0) === '§' ? '§' + s : s; }
  function unpackText(s, table) { if (typeof s !== 'string' || s.charAt(0) !== '§') return s; if (s.charAt(1) === '§') return s.slice(1); var x = table[+s.slice(1)]; return x == null ? s : x; }
  var DEF_TPL = null; // checklist answers of demo jobs are rebuilt from the built-in templates, whatever the user edits later
  function defTemplates() { return DEF_TPL || (DEF_TPL = makeTemplates()); }
  function sameRes(a, b) {
    var ka = Object.keys(a || {}), kb = Object.keys(b || {});
    return ka.length === kb.length && ka.every(function (k) { return a[k] === b[k]; });
  }
  var JOB_KEYS = { id: 'i', no: 'n', customerId: 'c', assetId: 'a', type: 't', priority: 'p', problem: 'q', source: 's', reportedAt: 'r', preferredDate: 'pd', status: 'st', date: 'd', window: 'w', span: 'sp',
    techId: 'h', travelAt: 'ta', arriveAt: 'aa', finishAt: 'fa', stage: 'sg', notes: 'nt', labourMin: 'lm', km: 'km', photos: 'ph', followUp: 'fu', followUpOf: 'fo', followUpId: 'fi', followUpNote: 'fn',
    visits: 'v', invoicedAt: 'ia', cancelledAt: 'xa', cancelReason: 'xr', partsNote: 'pn', log: 'lg', planDue: 'pv' };
  var JOB_DEF = { priority: 'normal', source: 'phone', preferredDate: '', date: '', window: '', span: 1, techId: '', travelAt: '', arriveAt: '', finishAt: '', stage: '', notes: '', labourMin: 0, km: 0,
    photos: [], followUp: false, followUpOf: '', followUpId: '', visits: [], invoicedAt: '', cancelledAt: '', cancelReason: '', partsNote: '', log: [] };
  var JOB_TEXT = { problem: 1, notes: 1, cancelReason: 1 };
  var CUST_KEYS = { id: 'i', name: 'n', type: 't', role: 'ro', phone: 'ph', email: 'e', street: 's', city: 'ci', access: 'ac', plan: 'pl', planSince: 'ps', notes: 'no' };
  var CUST_DEF = { type: 'household', role: '', access: '', plan: 'none', planSince: '', notes: '' };
  var ASSET_KEYS = { id: 'i', customerId: 'c', kind: 'k', brand: 'b', model: 'm', serial: 'sn', installed: 'in', lastService: 'ls', refrigerant: 'rf', charge: 'ch', location: 'lo' };
  var ASSET_DEF = { lastService: '', refrigerant: '', charge: null, location: '' };
  var ASSET_TEXT = { location: 1 };
  function invert(m) { var o = {}; Object.keys(m).forEach(function (k) { o[m[k]] = k; }); return o; }
  var JOB_R = invert(JOB_KEYS), CUST_R = invert(CUST_KEYS), ASSET_R = invert(ASSET_KEYS);
  function isDefault(v, d) { return v === d || (Array.isArray(v) && Array.isArray(d) && !v.length && !d.length); }
  function cloneDef(d) { return Array.isArray(d) ? [] : d; }
  /** generic: short keys, defaults dropped, texts numbered; keys handled elsewhere are in `skip`; unknown keys keep a ~ prefix */
  function packFields(o, map, def, texts, skip, out) {
    Object.keys(o).forEach(function (k) {
      if (skip && skip[k]) return;
      var v = o[k]; if (v === undefined) return;
      if (def && Object.prototype.hasOwnProperty.call(def, k) && isDefault(v, def[k])) return;
      if (texts && texts[k]) v = packText(v);
      out[map[k] || '~' + k] = v;
    });
    return out;
  }
  function unpackFields(p, rmap, def, texts, skip, out, table) {
    Object.keys(def).forEach(function (k) { out[k] = cloneDef(def[k]); });
    Object.keys(p).forEach(function (sk) {
      if (skip && skip[sk]) return;
      var k = sk.charAt(0) === '~' ? sk.slice(1) : rmap[sk] || sk, v = p[sk];
      out[k] = texts && texts[k] ? unpackText(v, table) : v;
    });
    return out;
  }
  var BILL_KEYS = ['labour', 'callout', 'km', 'parts', 'why'];
  function packBilling(b) {
    if (!b || typeof b !== 'object' || Object.keys(b).some(function (k) { return BILL_KEYS.indexOf(k) < 0; }) || (b.why && b.why !== 'plan' && b.why !== 'warranty') || b.why === undefined) return b;
    return (b.labour ? '1' : '0') + (b.callout ? '1' : '0') + (b.km ? '1' : '0') + (b.parts ? '1' : '0') + (b.why === 'plan' ? 'p' : b.why === 'warranty' ? 'w' : '');
  }
  function unpackBilling(s) { if (typeof s !== 'string') return s; return { labour: s[0] === '1', callout: s[1] === '1', km: s[2] === '1', parts: s[3] === '1', why: s[4] === 'p' ? 'plan' : s[4] === 'w' ? 'warranty' : '' }; }
  function pack(db) {
    if (!db || typeof db !== 'object' || !Array.isArray(db.jobs)) return db;
    var rateIx = {}, rateBook = [];
    function rateRef(rt) { var k = JSON.stringify(rt); if (rateIx[k] == null) { rateIx[k] = rateBook.length; rateBook.push(rt); } return rateIx[k]; }
    var skipJob = { createdAt: 1, checklist: 1, parts: 1, billing: 1, rates: 1, signature: 1 }, tpl = defTemplates(), assetById = {};
    db.assets.forEach(function (a) { assetById[a.id] = a; });
    var jobs = db.jobs.map(function (j) {
      var o = packFields(j, JOB_KEYS, JOB_DEF, JOB_TEXT, skipJob, {});
      if (j.createdAt !== j.reportedAt) o.cr = j.createdAt;
      var ck = j.checklist;
      if (ck && ck.seed && !ck.items && tpl[ck.key] && Object.keys(ck).every(function (k) { return k === 'key' || k === 'res' || k === 'seed'; }) &&
        sameRes(ck.res, demoChecklist(tpl[ck.key].items, ck.seed, assetById[j.assetId]))) o.k = ck.key + '*' + ck.seed; // answers untouched since the demo made them
      else if (ck !== undefined) o.k = ck;
      if (j.parts && j.parts.length) o.pt = j.parts.map(function (p) { return Object.keys(p).every(function (k) { return k === 'partId' || k === 'qty' || k === 'price' || k === 'van'; }) ? [p.partId, p.qty, p.price, p.van ? 1 : 0] : p; });
      else if (j.parts !== undefined && !Array.isArray(j.parts)) o.pt = j.parts;
      if (j.billing !== undefined) o.b = packBilling(j.billing);
      if (j.rates) o.rt = rateRef(j.rates);
      var sg = j.signature;
      if (sg && sg.demo === true && Object.keys(sg).length === 3 && sg.name && sg.at) o.si = [sg.name, sg.at];
      else if (sg !== null && sg !== undefined) o.si = sg;
      return o;
    });
    var customers = db.customers.map(function (c) {
      var o = packFields(c, CUST_KEYS, CUST_DEF, null, { contact: 1, postal: 1 }, {});
      if (c.contact !== c.name) o.co = c.contact;
      if (c.postal !== E.postalOf(c.city)) o.pc = c.postal;
      return o;
    });
    var assets = db.assets.map(function (a) {
      var o = packFields(a, ASSET_KEYS, ASSET_DEF, ASSET_TEXT, { interval: 1, warrantyUntil: 1 }, {});
      if (!E.KIND[a.kind] || a.interval !== E.KIND[a.kind].interval) o.iv = a.interval;
      if (!E.isDate(a.installed) || a.warrantyUntil !== E.addMonths(a.installed, a.kind === 'hp' ? 60 : 24)) o.wu = a.warrantyUntil;
      return o;
    });
    var doc = { packed: 1, texts: TEXTS };
    Object.keys(db).forEach(function (k) { if (k !== 'jobs' && k !== 'customers' && k !== 'assets') doc[k] = db[k]; });
    doc.rateBook = rateBook; doc.customers = customers; doc.assets = assets; doc.jobs = jobs;
    return doc;
  }
  function unpack(doc) {
    if (!doc || typeof doc !== 'object' || !doc.packed) return doc;
    var db = {};
    Object.keys(doc).forEach(function (k) { if (k !== 'packed' && k !== 'texts' && k !== 'rateBook' && k !== 'jobs' && k !== 'customers' && k !== 'assets') db[k] = doc[k]; });
    var rb = doc.rateBook || [], tpl = defTemplates(), table = Array.isArray(doc.texts) ? doc.texts : TEXTS;
    db.customers = (doc.customers || []).map(function (p) {
      var c = unpackFields(p, CUST_R, CUST_DEF, null, { co: 1, pc: 1 }, {}, table);
      c.contact = p.co != null ? p.co : c.name;
      c.postal = p.pc != null ? p.pc : E.postalOf(c.city);
      return c;
    });
    var assetById = {};
    db.assets = (doc.assets || []).map(function (p) {
      var a = unpackFields(p, ASSET_R, ASSET_DEF, ASSET_TEXT, { iv: 1, wu: 1 }, {}, table);
      a.interval = p.iv != null ? p.iv : (E.KIND[a.kind] ? E.KIND[a.kind].interval : 12);
      a.warrantyUntil = p.wu != null ? p.wu : E.addMonths(a.installed, a.kind === 'hp' ? 60 : 24);
      assetById[a.id] = a;
      return a;
    });
    var skip = { cr: 1, k: 1, pt: 1, b: 1, rt: 1, si: 1 };
    db.jobs = (doc.jobs || []).map(function (p) {
      var j = unpackFields(p, JOB_R, JOB_DEF, JOB_TEXT, skip, {}, table);
      j.createdAt = p.cr != null ? p.cr : j.reportedAt;
      if (typeof p.k === 'string') {
        var star = p.k.lastIndexOf('*'), key = p.k.slice(0, star), seed = +p.k.slice(star + 1), t = tpl[key];
        j.checklist = { key: key, res: demoChecklist(t ? t.items : [], seed, assetById[j.assetId]), seed: seed };
      } else if (p.k !== undefined) j.checklist = p.k;
      j.parts = Array.isArray(p.pt) ? p.pt.map(function (x) { return Array.isArray(x) ? { partId: x[0], qty: x[1], price: x[2], van: !!x[3] } : x; }) : p.pt !== undefined ? p.pt : [];
      if (p.b !== undefined) j.billing = unpackBilling(p.b);
      if (p.rt != null && rb[p.rt]) j.rates = rb[p.rt];
      j.signature = Array.isArray(p.si) ? { name: p.si[0], at: p.si[1], demo: true } : p.si !== undefined ? p.si : null;
      return j;
    });
    return db;
  }

  return {
    VERSION: VERSION, HISTORY_DAYS: HISTORY_DAYS, COMPANY: COMPANY, OFFICE: OFFICE, TECHS: TECHS, PARTS: PARTS, ITEMS: ITEMS, makeTemplates: makeTemplates, squiggle: squiggle, demoClock: demoClock,
    rng: rng, demoChecklist: demoChecklist, TEXTS: TEXTS, addPlanVisits: addPlanVisits, pack: pack, unpack: unpack, generate: generate, localText: localText, OLD_PHONES: OLD_PHONES, safePhone: safePhone
  };
});
