// The words on the public site, in Slovenian (first), Croatian and English. Prices come from public/data/prices.mjs and
// company details from public/data/company.mjs: never type a price or a company detail here.
//
// E-invoice deadlines (checked 15 Oct 2026):
//  - Croatia: B2B e-invoices (eRačun) with fiscalisation mandatory for VAT-registered businesses since 1 Jan 2026 under
//    the Fiscalisation Act (Zakon o fiskalizaciji, NN 89/25, "Fiskalizacija 2.0"); non-VAT businesses must issue them from
//    1 Jan 2027; KPD 2025 code on every line; monthly e-reporting of payments.
//    Sources: https://porezna-uprava.gov.hr/hr/porezna-uprava-aktivno-priprema-obveznike-na-fiskalizaciju-eracuna/8095
//             https://kpmg.com/hr/hr/mediji/press-releases/2025/07/fiskalizacija-2-0.html
//             https://www.teb.hr/novosti/2025/vodic-kroz-novu-fiskalizaciju-odgovori-na-24-pitanja/
//  - Slovenia: Zakon o izmenjavi elektronskih računov in drugih elektronskih dokumentov (ZIERDED), passed by the National
//    Assembly on 23 Oct 2025, Uradni list RS 85/2025 (6 Nov 2025): mandatory B2B e-invoice exchange from 1 Jan 2028.
//    Sources: https://www.gov.si/novice/2025-10-23-drzavni-zbor-sprejel-zakon-o-izmenjavi-elektronskih-racunov-in-drugih-elektronskih-dokumentov/
//             https://www.uradni-list.si/glasilo-uradni-list-rs/vsebina/2025-01-3032
//             https://www.pwc.com/si/sl/aktualno/Zakon-o-izmenjavi-elektronskih-racunov-in-drugih-elektronskih-dokumentov.html
import { eur, date } from './format.mjs';

export const LANGS = ['sl', 'hr', 'en'];
export const HR_DATE = '2026-01-01', SI_DATE = '2028-01-01';

// The four products, in the order shown; `app` is the demo folder (copied from site/<app>/ by the build)
export const PRODUCTS = ['datacheck', 'collections', 'cashflow', 'budget'];

// "Built for clients": names and one line only, never a link into the private apps. [icon id, sl, hr, en]
export const BUILT = [
  ['recon', ['Usklajevanje plačil', 'Plačila, vračila in izplačila, povezana z naročili in banko, z izvozom za zaključek meseca.'], ['Usklađivanje plaćanja', 'Plaćanja, povrati i isplate povezani s narudžbama i bankom, s izvozom za zatvaranje mjeseca.'], ['Payment reconciliation', 'Payments, refunds and payouts matched to orders and the bank, with a month-end export.']],
  ['contracts', ['Pogodbe in podaljšanja', 'Vsak najem in dobaviteljska pogodba z odpovednimi roki, podaljšanji in letnim zneskom.'], ['Ugovori i obnove', 'Svaki najam i ugovor s dobavljačem s otkaznim rokovima, obnovama i godišnjim iznosom.'], ['Contracts & renewals', 'Every lease and supplier contract with notice deadlines, renewals and annual spend.']],
  ['crm', ['CRM', 'Podjetja, kontakti, prodajni lijak in aktivnosti z napovedjo in deležem dobljenih poslov.'], ['CRM', 'Tvrtke, kontakti, prodajni lijevak i aktivnosti s prognozom i stopom uspjeha.'], ['CRM', 'Companies, contacts, a deal pipeline and activities, with forecasts and win rates.']],
  ['erp', ['ERP', 'Artikli in zaloga po lokacijah, nabava, prodajna naročila, računi in plačila.'], ['ERP', 'Artikli i zalihe po lokacijama, nabava, prodajni nalozi, računi i plaćanja.'], ['ERP', 'Products and stock per location, purchasing, sales orders, invoices and payments.']],
  ['stores', ['Dnevna tabla trgovin', 'Včerajšnja prodaja, mesec do danes glede na cilj in današnja ekipa po trgovinah.'], ['Dnevna ploča trgovina', 'Jučerašnja prodaja, mjesec do danas prema cilju i današnji tim po trgovinama.'], ['Store daily board', 'Yesterday’s sales, month-to-date against target and today’s team, per store.']],
  ['parcels', ['Paketi in odkupnine', 'Vsi paketi pri vseh dostavljavcih, zataknjene pošiljke in usklajene odkupnine.'], ['Paketi i pouzeća', 'Svi paketi kod svih dostavljača, zapele pošiljke i usklađena pouzeća.'], ['Parcels & COD', 'Every parcel across carriers, stuck shipments worked, cash on delivery reconciled.']],
  ['service', ['Servisni nalogi', 'Tehnikov dan na telefonu s kontrolnim seznamom, fotografijami in podpisom ter razpored nalogov.'], ['Servisni nalozi', 'Dan tehničara na mobitelu s kontrolnom listom, fotografijama i potpisom te raspored naloga.'], ['Service jobs', 'A technician’s day on the phone with checklists, photos and signatures, plus a dispatch board.']],
  ['leave', ['Delovni čas in dopusti', 'Zahtevki za dopust, timski koledar s prazniki in mesečna evidenca delovnega časa.'], ['Radno vrijeme i godišnji', 'Zahtjevi za godišnji, timski kalendar s praznicima i mjesečna evidencija radnog vremena.'], ['Time & leave', 'Leave requests and approvals, a team calendar with public holidays and monthly working-time records.']],
  ['onboarding', ['Prihodi in odhodi zaposlenih', 'Kontrolni seznami za nove sodelavce, premestitve in odhode za kadrovsko, IT in vodje.'], ['Dolasci i odlasci zaposlenika', 'Kontrolne liste za nove kolege, premještaje i odlaske za HR, IT i voditelje.'], ['Joiners & leavers', 'Checklists for new hires, moves and leavers across HR, IT and managers.']],
  ['team-tasks', ['Naloge ekipe', 'Naloge, cikli in projekti s tablo, nabiralnikom in bližnjicami.'], ['Zadaci tima', 'Zadaci, ciklusi i projekti s pločom, pretincem i prečacima.'], ['Team tasks', 'Issues, cycles and projects with a board, an inbox and keyboard shortcuts.']],
  ['mail', ['E-poštni marketing', 'Profili, segmenti, kampanje, urejevalnik in samodejni tokovi.'], ['E-mail marketing', 'Profili, segmenti, kampanje, uređivač i automatski tokovi.'], ['Email marketing', 'Profiles, segments, campaigns, an editor and automated flows.']],
  ['marketing', ['Marketinški koledar', 'Vse kampanje in akcije po trgih v enem koledarju, ob porabi in zaslužku.'], ['Marketinški kalendar', 'Sve kampanje i akcije po tržištima u jednom kalendaru, uz potrošnju i zaradu.'], ['Marketing calendar', 'Every campaign and promotion per market in one calendar, next to what it spent and earned.']],
  ['analytics', ['Analitika', 'Prodaja, trgovine, lijak, donos oglasov in kohorte kupcev s filtri in primerjavami.'], ['Analitika', 'Prodaja, trgovine, lijevak, povrat oglasa i kohorte kupaca s filterima i usporedbama.'], ['Analytics', 'Sales, stores, funnel, ad return and customer cohorts, with filters and comparisons.']],
  ['margin', ['Varuh marže', 'Kateri popusti, ceniki, blagovne znamke in trgovine izgubljajo maržo.'], ['Čuvar marže', 'Koji popusti, cjenici, brendovi i trgovine gube maržu.'], ['Margin guard', 'Which discounts, price lists, brands and shops lose margin.']],
  ['ads', ['Oglasi in donos', 'Poraba za Google Ads in Meta glede na prihodke, po trgih in kampanjah.'], ['Oglasi i povrat', 'Potrošnja za Google Ads i Meta prema prihodima, po tržištima i kampanjama.'], ['Ads & return', 'Google Ads and Meta spend against revenue, per market and campaign.']],
  ['webshop', ['Konverzija spletne trgovine', 'Kje kupci odpadejo po trgovini, napravi in strani, in katero merjenje ne deluje.'], ['Konverzija web trgovine', 'Gdje kupci odustaju po trgovini, uređaju i stranici, i koje mjerenje ne radi.'], ['Web shop conversion', 'Where shoppers drop off, by shop, device and page, and which tracking looks broken.']],
  ['cs-quality', ['Kakovost podpore', 'NPS, odzivni časi, SLA in delež vprašanj, ki jih reši klepetalnik.'], ['Kvaliteta podrške', 'NPS, vrijeme odgovora, SLA i udio pitanja koje riješi chatbot.'], ['Customer service quality', 'NPS, answer times, SLA and how much the chatbot handles.']],
  ['n8n', ['Avtomatizacije', 'Vsak potek v n8n: zdravje, zagoni na dan, zamujeni in neuspeli zagoni.'], ['Automatizacije', 'Svaki tok u n8n: zdravlje, pokretanja po danu, propuštena i neuspjela pokretanja.'], ['Automation runs', 'Every n8n workflow: health, runs per day, missed and failed runs.']]
];

export function content(lang, P, C) {
  const e = (n) => eur(n, lang);
  const d = (iso) => date(iso, lang);
  const T = { sl, hr, en }[lang];
  return T(P, C, e, d);
}

// ── Slovenian ──────────────────────────────────────────────────────────────────────────────────────────────────────
function sl(P, C, e, d) {
  const mo = (n) => e(n) + '/mesec', from = (n) => 'od ' + e(n);
  return {
    locale: 'sl-SI',
    title: 'Clearfigure – priprava na e-račune, terjatve, likvidnost in plan',
    description: 'Preverimo in uredimo matične podatke pred obveznimi e-računi (Hrvaška od 1. 1. 2026, Slovenija od 1. 1. 2028) ter uvedemo orodja za terjatve, napoved likvidnosti in plan.',
    skip: 'Skoči na vsebino',
    nav: { einv: 'E-računi', products: 'Paketi', demo: 'Demo', about: 'O meni', faq: 'Vprašanja', contact: 'Kontakt', cta: 'Pišite nam', menu: 'Meni', lang: 'Jezik' },
    hero: {
      eyebrow: 'Obvezni e-računi: Hrvaška od ' + d(HR_DATE) + ' · Slovenija od ' + d(SI_DATE),
      h1: 'Pripravite podatke na obvezne <span class="grad">e-račune</span>.',
      lead: 'Preverimo in uredimo vaše matične podatke – davčne številke, IBAN-e, naslove in dvojnike –, povežemo ERP z izmenjavo e-računov in vam damo orodja za terjatve, likvidnost in plan. Za slovenska in hrvaška podjetja.',
      cta1: 'Brezplačen pregled podatkov', cta2: 'Rezervirajte 20 minut',
      note: 'Pregled teče v vašem brskalniku: datoteka ne zapusti vašega računalnika.'
    },
    deadlines: {
      label: 'Roki za e-račune',
      hr: { kicker: 'Hrvaška · Fiskalizacija 2.0', when: d(HR_DATE), status: 'že velja', text: 'Zavezanci za DDV izdajajo in prejemajo B2B e-račune (UBL 2.1) z davčno potrditvijo. Vsaka postavka potrebuje šifro KPD 2025, plačila izdanih e-računov pa se poročajo mesečno. Od 1. 1. 2027 tudi za podjetja zunaj sistema DDV.' },
      si: { kicker: 'Slovenija · ZIERDED', when: d(SI_DATE), status: ['še {n} dan', 'še {n} dneva', 'še {n} dnevi', 'še {n} dni'], text: 'Vsa podjetja in s. p. iz Poslovnega registra si bodo med seboj izmenjevala samo še strukturirane e-račune (e-SLOG ali EN 16931, npr. prek Peppola). PDF po e-pošti ne bo več zadoščal.' },
      foot: 'Povzetek predpisov, ne pravni nasvet.'
    },
    steps: {
      eyebrow: 'V treh korakih', h2: 'Od pregleda do e-računa, ki ga partner sprejme.',
      items: [
        ['Pregled podatkov', 'Naložite seznam kupcev, dobaviteljev ali artiklov. V nekaj minutah vidite neveljavne davčne številke, IBAN-e, OIB-e, poštne številke, dvojnike in oceno pripravljenosti na e-račune.', 'Samopregled brezplačno · poročilo s klicem ' + e(P.datacheck.report)],
        ['Čiščenje matičnih podatkov', 'Uredimo davčne številke, IBAN-e, naslove in dvojnike, za Hrvaško dodamo šifre KPD in pripravimo uvozno datoteko za Minimax ali Pantheon. Na koncu: ocena prej in potem.', from(P.datacheck.cleanupFrom)],
        ['Povezava za e-račune', 'Izvoz iz vašega ERP-ja povežemo s ponudnikom za izmenjavo e-računov (e-SLOG, UBL, Peppol) in vse preizkusimo s tremi ključnimi partnerji.', from(P.einvoice.connectionFrom)]
      ],
      bundle: 'Paket pripravljenosti: vsi trije koraki za <b>' + e(P.einvoice.readinessBundle) + '</b> namesto ' + e(P.einvoice.readinessInsteadOf) + '. Podpora po uvedbi ' + mo(P.einvoice.supportMonthly) + '.',
      cta: 'Začnite s 1. korakom'
    },
    products: {
      eyebrow: 'Paketi in cene', h2: 'Štiri orodja. Preizkusite jih takoj.',
      lead: 'Vsako orodje odprete na izmišljenem podjetju Nordvik Distribucija d.o.o. Za vaše podjetje ga namestimo na vaših podatkih iz Minimaxa, Pantheona ali Excela.',
      open: 'Odpri demo', ask: 'Povpraševanje', tagFree: 'Brezplačen začetek',
      items: {
        datacheck: { name: 'Pregled podatkov', text: 'Preveri seznam kupcev, dobaviteljev ali artiklov: davčne številke (SI/HR), OIB, IBAN, EAN, e-pošto, telefon, poštne številke in dvojnike – in vrne očiščeno datoteko.', rows: [['Samopregled na spletu', 'brezplačno'], ['Poročilo in 45-minutni klic', e(P.datacheck.report)], ['Čiščenje pred e-računi', from(P.datacheck.cleanupFrom)]], small: 'Poročilo zajema do tri sezname in 20.000 vrstic ter se v celoti upošteva, če čiščenje naročite v ' + P.datacheck.reportCreditDays + ' dneh. Čiščenje do 10.000 partnerjev in 10.000 artiklov: ' + e(P.datacheck.cleanupLarge) + '.' },
        collections: { name: 'Terjatve in opomini', text: 'Kdo vam dolguje, koga poklicati danes in opomin z zakonskimi zamudnimi obrestmi, nadomestilom 40 € in UPN QR – v slovenščini, hrvaščini ali angleščini.', rows: [['Namestitev', e(P.collections.setup)], ['Mesečno, do ' + P.collections.users + ' uporabnikov', mo(P.collections.monthly)]], small: 'Dodatni uporabnik ' + mo(P.collections.extraUser) + '. Letno plačilo ' + e(P.collections.annual) + ' (dva meseca gratis). Namestitev vključuje uvoz odprtih postavk, predloge opominov z vašim logotipom in eno uro uvajanja.' },
        cashflow: { name: 'Napoved likvidnosti (13 tednov)', text: 'Teden za tednom vidite, koliko denarja boste imeli na računu, in pravočasno opazite luknjo v denarnem toku – s scenariji in predlogi, kaj storiti.', rows: [['Namestitev', e(P.cashflow.setup)], ['Mesečno', mo(P.cashflow.monthly)], ['S pregledom vsaka dva tedna', mo(P.cashflow.reviewMonthly)]], small: 'Pregled: enourni klic vsaka dva tedna in kratek zapis za direktorja. Namestitev vključuje uvoz iz vašega ERP-ja, začetna stanja z bančnega izpiska in prvo napoved, ki jo pripravimo skupaj.' },
        budget: { name: 'Plan in realizacija', text: 'Plan in dejanski rezultati po kontih, stroškovnih mestih in mesecih, odstopanja, ki jih je treba pojasniti, most EBITDA in mesečno poročilo za upravo v slovenščini, hrvaščini ali angleščini.', rows: [['Namestitev', e(P.budget.setup)], ['Mesečno', mo(P.budget.monthly)], ['Poročilo pripravimo mi', mo(P.budget.preparedMonthly)]], small: 'Namestitev vključuje preslikavo kontnega načrta, uvoz plana iz Excela in dve skupni mesečni zapiranji.' }
      },
      bundle: '<b>Denarni tok:</b> Terjatve in Napoved likvidnosti na istih podatkih – namestitev ' + e(P.bundle.setup) + ', ' + mo(P.bundle.monthly) + '.',
      custom: '<b>Aplikacije po meri:</b> ' + e(P.custom.dayRate) + '/dan ali fiksna cena po plačani analizi (' + e(P.custom.scoping) + ', upošteva se pri projektu).',
      founding: '<b>Prve ' + P.founding.customers + ' stranke:</b> ' + P.founding.setupDiscountPct + ' % popusta na namestitev v zameno za študijo primera (z imenom ali anonimno).',
      terms: 'Mesečne pakete lahko odpoveste vsak mesec. ' + C.vatNote.sl
    },
    calc: {
      eyebrow: 'Kalkulator', h2: 'Koliko vas stane ročno delo?',
      lead: 'Prepisovanje izvozov, popravljanje formul, vsak ponedeljek isto poročilo. Vnesite svoje številke in poglejte, koliko časa bi vrnila avtomatizacija.',
      people: 'Število ljudi, ki ročno pripravljajo poročila ali prepisujejo podatke', hours: 'Ur na teden na osebo', rate: 'Strošek ure (plača in stroški dela)', share: 'Delež dela, ki ga je mogoče avtomatizirati',
      back: 'Vsako leto nazaj', hoursLine: '{saved} ur na leto od {now} ur ročnega dela', now: 'Danes', after: 'Avtomatizirano',
      fte: 'zaposlenih s polnim delovnim časom', weeks: 'delovnih tednov na osebo na leto',
      note: 'Izračun: 40-urni teden in 1.800 delovnih ur na leto (45 tednov). Ocena iz vaših vnosov, ne ponudba.',
      use: 'Dodaj v sporočilo', used: 'Številke so v sporočilu spodaj.',
      line: 'Naša ocena: {p} ljudi porabi približno {h} ur na teden za ročna poročila ({now} ur na leto). Avtomatizacija {s} tega bi vrnila okoli {saved} ur oziroma {value} na leto.'
    },
    story: {
      eyebrow: 'Vodeni demo', h2: 'En teden v podjetju Nordvik.',
      lead: 'Nordvik Distribucija d.o.o. je izmišljen veletrgovec z materialom za ogrevanje, vodovod in elektro instalacije. Sledite zgodbi – vsak korak odpre demo na pravem zaslonu.',
      open: 'Odpri ta korak',
      items: [
        ['cashflow', '#/weeks', 'Napoved likvidnosti', 'Sredi napovedi denar pade pod minimum.', 'V 13-tedenski napovedi stanje na računu sredi obdobja pade pod varnostni minimum 150.000 €. Napoved pokaže, v katerem tednu, zakaj in kaj lahko storite.'],
        ['collections', '#/', 'Terjatve', 'Seznam klicev za danes.', 'Terjatve razvrstijo kupce, ki jih je danes vredno poklicati: največji zneski v zamudi, prelomljene obljube in opomini, ki čakajo.'],
        ['collections', '#/promises', 'Terjatve', 'Obljuba plačila.', 'Kupec obljubi, da plača do petka? Zabeležite datum in znesek, aplikacija pa opozori, ko obljuba poteče. V demu napoved likvidnosti uporablja iste račune in obljube.'],
        ['budget', '#/comments', 'Plan in realizacija', 'Odstopanje, ki ga je treba pojasniti.', 'Prihodki in stroški, ki odstopajo od plana, čakajo na komentar – in gredo s komentarjem v poročilo za upravo.'],
        ['datacheck', '#/', 'Pregled podatkov', 'Zakaj sploh zamude? Podatki.', 'Napačna davčna številka ali IBAN in dvojniki kupcev pomenijo zavrnjene e-račune in opomine na napačen naslov. Preverite demo seznam ali svojega.']
      ],
      note: 'Demo podatki so izmišljeni in ostanejo v vašem brskalniku. Nič se ne pošlje nikomur.'
    },
    built: { eyebrow: 'Zgrajeno za stranke', h2: 'In še aplikacije za finance, prodajo in operativo.', lead: 'Vse temeljijo na istem pristopu: vaš proces, vaši podatki, brez menjave ERP-ja. Pokažemo jih na sestanku.' },
    about: {
      eyebrow: 'O meni', h2: 'Za podjetjem Clearfigure stojim jaz.', photo: '[Fotografija]',
      bio: 'Gradim podatkovne platforme, poročila Power BI in poslovne aplikacije za finance, prodajo in operativo. Delam neposredno z vami: od prvega pregleda podatkov do aplikacije, ki jo vaša ekipa uporablja vsak dan.',
      bio2: 'Študiral sem na Ekonomski fakulteti Univerze v Ljubljani in delam kot podatkovni in BI analitik ter finančni kontroler (Python, SQL, BigQuery, Power BI). Zato vprašanja financ poznam iz prve roke, ne samo iz kode.',
      cases: 'Primera iz demo aplikacij', casesNote: 'Nordvik Distribucija d.o.o. je izmišljeno podjetje iz demo aplikacij; številke izračunajo aplikacije same na demo podatkih. Študije primerov resničnih strank bomo objavili s soglasjem strank.',
      case1: { kicker: 'Primer · izmišljeno podjetje, veleprodaja', title: 'Terjatve in opomini', metrics: [['Odprte terjatve', '2.246.447 € pri 56 kupcih'], ['Zapadlo', '667.864 € (52 računov)'], ['Dnevi plačila (DSO)', '63 dni'], ['Na seznamu za klic danes', '24 kupcev']], text: 'Aplikacija iz odprtih računov sama sestavi seznam, koga poklicati danes, izračuna zakonske zamudne obresti in pripravi opomin s QR kodo UPN. Plačila iz bančnega izpiska (camt.053) poveže z računi po sklicu.' },
      case2: { kicker: 'Primer · seznam kupcev iz starega ERP', title: 'Pregled in čiščenje podatkov', metrics: [['Ocena kakovosti podatkov', '55 → 75'], ['Pripravljenost na e-račune', '55 % → 67 %'], ['Samodejni popravki', '1.131 v 420 vrsticah']], text: 'Datoteka s 420 kupci: preverjanje davčnih številk, IBAN-ov, poštnih številk in dvojnikov, nato popravki z enim klikom. Vse teče v brskalniku; datoteka ne zapusti računalnika.' },
    },
    faq: {
      eyebrow: 'Vprašanja', h2: 'Dobro je vedeti.',
      items: [
        ['Kje so shranjeni podatki v demu?', 'Samo v vašem brskalniku (v shrambi te strani na vaši napravi). Demo ne pošilja podatkov nam ali komurkoli drugemu. Izbrišete jih s ponastavitvijo demo podatkov v nastavitvah aplikacije ali tako, da v brskalniku počistite podatke te strani.'],
        ['Ali datoteka pri pregledu podatkov zapusti moj računalnik?', 'Ne. Datoteko prebere in preveri vaš brskalnik, na strežnik se ne naloži. Za branje Excelovih datotek stran ob prvi uporabi naloži knjižnico SheetJS s cdnjs.cloudflare.com; vaša datoteka pri tem ne potuje nikamor. Spletno preverjanje ID za DDV v sistemu VIES na tej strani ni na voljo – opravimo ga v plačljivem poročilu.'],
        ['Kaj se zgodi s sporočilom iz obrazca?', 'Shranimo ga, da vam lahko odgovorimo: ime, podjetje, e-naslov, telefon, če ga vpišete, in sporočilo. Podrobnosti so v <a href="/zasebnost/">izjavi o zasebnosti</a>.'],
        ['Kje bodo podatki, ko orodje uporabljamo za svoje podjetje?', 'To se dogovorimo pred začetkom: kje aplikacija teče in kje so shranjeni podatki, kdo ima dostop ter kako dobite izvoz ali varnostno kopijo. Zapišemo v pogodbo in pogodbo o obdelavi osebnih podatkov.'],
        ['Ali moramo zamenjati ERP?', 'Ne. Orodja berejo izvoze iz Minimaxa, Pantheona ali Excela (CSV) in bančne izpiske (camt.053); ob namestitvi preslikamo vaše stolpce. Vaš ERP ostane glavni sistem.'],
        ['Kaj točno postane obvezno pri e-računih?', 'Na Hrvaškem od ' + d(HR_DATE) + ' zavezanci za DDV med seboj izmenjujejo e-račune v obliki UBL 2.1 prek informacijskih posrednikov, z davčno potrditvijo in šifro KPD na vsaki postavki; od 1. 1. 2027 velja tudi za podjetja zunaj sistema DDV. V Sloveniji od ' + d(SI_DATE) + ' vsi poslovni subjekti med seboj izmenjujejo samo še strukturirane e-račune (e-SLOG ali EN 16931) – prek ponudnikov, omrežja Peppol ali neposredno. To je povzetek, ne pravni nasvet.'],
        ['Ali lahko paket kadar koli odpovem?', 'Da. Mesečni paketi se odpovedo za naslednji mesec; dolgoročne vezave ni.'],
        ['Ali je izračun obresti v opominih pravni nasvet?', 'Ne. Zakonske zamudne obresti, nadomestilo 40 € in besedila opominov so privzete nastavitve, ki jih ob namestitvi preverimo z vami. Za izterjavo na sodišču potrebujete odvetnika.'],
        ['Ali stran uporablja piškotke ali sledilnike?', 'Ne. Ni piškotkov, ni analitike in ni zunanjih pisav. Demo aplikacije shranjujejo samo vaše delo v brskalniku na vaši napravi.']
      ]
    },
    contact: {
      eyebrow: 'Kontakt', h2: 'Povejte, kje ste. Predlagamo, kje začeti.', lead: 'Odgovorim osebno.',
      name: 'Ime in priimek', company: 'Podjetje', email: 'E-pošta', phone: 'Telefon', optional: 'neobvezno', product: 'Kaj vas zanima', message: 'Sporočilo',
      placeholder: 'Kateri ERP uporabljate, koliko kupcev in računov imate na mesec, kaj vas najbolj žuli …',
      options: { datacheck: 'Pregled in čiščenje podatkov', einvoice: 'E-računi', collections: 'Terjatve in opomini', cashflow: 'Napoved likvidnosti', budget: 'Plan in realizacija', custom: 'Aplikacija po meri', other: 'Nekaj drugega' },
      honeypot: 'Tega polja ne izpolnjujte',
      submit: 'Pošlji sporočilo', sending: 'Pošiljam …',
      privacy: 'Podatke iz obrazca uporabimo samo za odgovor na vaše sporočilo. Več v <a href="/zasebnost/">izjavi o zasebnosti</a>.',
      side: 'Raje v živo?', sideText: '20 minut, brez obveznosti: povejte, kaj vas žuli, in predlagam prvi korak.', book: 'Rezervirajte 20 minut', orWrite: 'ali pišite na',
      bookSubject: 'Termin za 20-minutni pogovor', mailSubject: 'Povpraševanje s spletne strani',
      msg: {
        ok: 'Hvala, sporočilo je prejeto. Odgovorim vam na navedeni e-naslov.',
        invalid: 'Preverite označena polja.',
        tooFast: 'Počakajte trenutek in poskusite znova.',
        rate: 'Poslali ste že več sporočil. Poskusite znova čez eno uro ali pišite po e-pošti.',
        fail: 'Sporočila zdaj ni bilo mogoče poslati.', mailto: 'Pošljite ga po e-pošti',
        name: 'Vpišite ime (2–100 znakov).', email: 'Vpišite veljaven e-naslov.', phone: 'Telefon lahko vsebuje števke, presledke in znake + ( ) / - .', message: 'Napišite vsaj nekaj besed (10–4.000 znakov).', company: 'Največ 120 znakov.'
      }
    },
    footer: {
      tagline: 'Clearfigure – podatki, analitika in poslovne aplikacije za slovenska in hrvaška podjetja.',
      privacy: 'Zasebnost', legal: 'Pravno obvestilo', contact: 'Kontakt', demoNote: 'Vsi podatki v demo aplikacijah so izmišljeni.',
      reg: 'Matična številka', tax: 'Davčna številka', capital: 'Osnovni kapital', legalLang: ''
    }
  };
}

// ── Croatian ───────────────────────────────────────────────────────────────────────────────────────────────────────
function hr(P, C, e, d) {
  const mo = (n) => e(n) + '/mj.', from = (n) => 'od ' + e(n);
  return {
    locale: 'hr-HR',
    title: 'Clearfigure – priprema za eRačune, potraživanja, likvidnost i plan',
    description: 'Provjerimo i uredimo matične podatke za obvezne eRačune (Hrvatska od 1. 1. 2026., Slovenija od 1. 1. 2028.) i uvedemo alate za potraživanja, prognozu likvidnosti i plan.',
    skip: 'Preskoči na sadržaj',
    nav: { einv: 'eRačuni', products: 'Paketi', demo: 'Demo', about: 'O meni', faq: 'Pitanja', contact: 'Kontakt', cta: 'Javite se', menu: 'Izbornik', lang: 'Jezik' },
    hero: {
      eyebrow: 'Obvezni eRačuni: Hrvatska od ' + d(HR_DATE) + ' · Slovenija od ' + d(SI_DATE),
      h1: 'Pripremite podatke za obvezne <span class="grad">eRačune</span>.',
      lead: 'Provjerimo i uredimo vaše matične podatke – OIB-e, PDV ID-eve, IBAN-e, adrese i duplikate –, povežemo ERP s razmjenom eRačuna i damo vam alate za potraživanja, likvidnost i plan. Za slovenske i hrvatske tvrtke.',
      cta1: 'Besplatna provjera podataka', cta2: 'Rezervirajte 20 minuta',
      note: 'Provjera radi u vašem pregledniku: datoteka ne napušta vaše računalo.'
    },
    deadlines: {
      label: 'Rokovi za eRačune',
      hr: { kicker: 'Hrvatska · Fiskalizacija 2.0', when: d(HR_DATE), status: 'već vrijedi', text: 'Obveznici PDV-a izdaju i primaju B2B eRačune (UBL 2.1) uz fiskalizaciju. Svaka stavka treba KPD 2025 šifru, a plaćanja izdanih eRačuna prijavljuju se mjesečno. Od 1. 1. 2027. i za tvrtke izvan sustava PDV-a.' },
      si: { kicker: 'Slovenija · ZIERDED', when: d(SI_DATE), status: ['još {n} dan', 'još {n} dana', 'još {n} dana'], text: 'Sve tvrtke i obrtnici iz slovenskog Poslovnog registra međusobno će razmjenjivati samo strukturirane eRačune (e-SLOG ili EN 16931, npr. putem Peppola). PDF e-poštom više neće biti dovoljan.' },
      foot: 'Sažetak propisa, a ne pravni savjet.'
    },
    steps: {
      eyebrow: 'U tri koraka', h2: 'Od provjere do eRačuna koji partner prihvati.',
      items: [
        ['Provjera podataka', 'Učitajte popis kupaca, dobavljača ili artikala. Za nekoliko minuta vidite neispravne OIB-e i PDV ID-eve, IBAN-e, poštanske brojeve, duplikate i ocjenu spremnosti za eRačune.', 'Samoprovjera besplatno · izvještaj s pozivom ' + e(P.datacheck.report)],
        ['Čišćenje matičnih podataka', 'Uredimo OIB-e, PDV ID-eve, IBAN-e, adrese i duplikate, artiklima dodamo KPD šifre i pripremimo datoteku za uvoz u Minimax ili Pantheon. Na kraju: ocjena prije i poslije.', from(P.datacheck.cleanupFrom)],
        ['Povezivanje za eRačune', 'Izvoz iz vašeg ERP-a povežemo s vašim informacijskim posrednikom (UBL, e-SLOG, Peppol) i sve testiramo s tri ključna partnera.', from(P.einvoice.connectionFrom)]
      ],
      bundle: 'Paket spremnosti: sva tri koraka za <b>' + e(P.einvoice.readinessBundle) + '</b> umjesto ' + e(P.einvoice.readinessInsteadOf) + '. Podrška nakon uvođenja ' + mo(P.einvoice.supportMonthly) + '.',
      cta: 'Počnite s 1. korakom'
    },
    products: {
      eyebrow: 'Paketi i cijene', h2: 'Četiri alata. Isprobajte ih odmah.',
      lead: 'Svaki alat otvarate na izmišljenoj tvrtki Nordvik Distribucija d.o.o. Za vašu tvrtku postavimo ga na vašim podacima iz Minimaxa, Pantheona ili Excela.',
      open: 'Otvori demo', ask: 'Upit', tagFree: 'Besplatan početak',
      items: {
        datacheck: { name: 'Provjera podataka', text: 'Provjerava popis kupaca, dobavljača ili artikala: PDV ID-eve (SI/HR), OIB, IBAN, EAN, e-poštu, telefon, poštanske brojeve i duplikate – i vraća očišćenu datoteku.', rows: [['Samoprovjera na webu', 'besplatno'], ['Izvještaj i poziv od 45 minuta', e(P.datacheck.report)], ['Čišćenje prije eRačuna', from(P.datacheck.cleanupFrom)]], small: 'Izvještaj obuhvaća do tri popisa i 20.000 redaka i u cijelosti se uračunava ako čišćenje naručite u ' + P.datacheck.reportCreditDays + ' dana. Čišćenje do 10.000 partnera i 10.000 artikala: ' + e(P.datacheck.cleanupLarge) + '.' },
        collections: { name: 'Potraživanja i opomene', text: 'Tko vam duguje, koga nazvati danas i opomena sa zakonskim zateznim kamatama, naknadom od 40 € i QR kodom za plaćanje – na hrvatskom, slovenskom ili engleskom.', rows: [['Postavljanje', e(P.collections.setup)], ['Mjesečno, do ' + P.collections.users + ' korisnika', mo(P.collections.monthly)]], small: 'Dodatni korisnik ' + mo(P.collections.extraUser) + '. Godišnje plaćanje ' + e(P.collections.annual) + ' (dva mjeseca gratis). Postavljanje uključuje uvoz otvorenih stavki, predloške opomena s vašim logotipom i sat vremena uvođenja.' },
        cashflow: { name: 'Prognoza likvidnosti (13 tjedana)', text: 'Tjedan po tjedan vidite koliko ćete novca imati na računu i na vrijeme uočite rupu u novčanom toku – sa scenarijima i prijedlozima što učiniti.', rows: [['Postavljanje', e(P.cashflow.setup)], ['Mjesečno', mo(P.cashflow.monthly)], ['S pregledom svaka dva tjedna', mo(P.cashflow.reviewMonthly)]], small: 'Pregled: jednosatni poziv svaka dva tjedna i kratka bilješka za direktora. Postavljanje uključuje uvoz iz vašeg ERP-a, početna stanja s bankovnog izvoda i prvu prognozu koju radimo zajedno.' },
        budget: { name: 'Plan i ostvarenje', text: 'Plan i stvarni rezultati po kontima, mjestima troška i mjesecima, odstupanja koja treba objasniti, EBITDA most i mjesečni izvještaj za upravu na hrvatskom, slovenskom ili engleskom.', rows: [['Postavljanje', e(P.budget.setup)], ['Mjesečno', mo(P.budget.monthly)], ['Izvještaj pripremamo mi', mo(P.budget.preparedMonthly)]], small: 'Postavljanje uključuje mapiranje kontnog plana, uvoz plana iz Excela i dva zajednička mjesečna zatvaranja.' }
      },
      bundle: '<b>Novčani tok:</b> Potraživanja i Prognoza likvidnosti na istim podacima – postavljanje ' + e(P.bundle.setup) + ', ' + mo(P.bundle.monthly) + '.',
      custom: '<b>Aplikacije po mjeri:</b> ' + e(P.custom.dayRate) + '/dan ili fiksna cijena nakon plaćene analize (' + e(P.custom.scoping) + ', uračunava se u projekt).',
      founding: '<b>Prva ' + P.founding.customers + ' klijenta:</b> ' + P.founding.setupDiscountPct + ' % popusta na postavljanje u zamjenu za studiju slučaja (s imenom ili anonimno).',
      terms: 'Mjesečne pakete možete otkazati svaki mjesec. ' + C.vatNote.hr
    },
    calc: {
      eyebrow: 'Kalkulator', h2: 'Koliko vas košta ručni rad?',
      lead: 'Prepisivanje izvoza, popravljanje formula, svaki ponedjeljak isti izvještaj. Unesite svoje brojke i pogledajte koliko bi vremena vratila automatizacija.',
      people: 'Broj ljudi koji ručno rade izvještaje ili prepisuju podatke', hours: 'Sati tjedno po osobi', rate: 'Trošak sata (plaća i troškovi rada)', share: 'Udio posla koji se može automatizirati',
      back: 'Svake godine natrag', hoursLine: '{saved} sati godišnje od {now} sati ručnog rada', now: 'Danas', after: 'Automatizirano',
      fte: 'zaposlenika s punim radnim vremenom', weeks: 'radnih tjedana po osobi godišnje',
      note: 'Izračun: tjedan od 40 sati i 1.800 radnih sati godišnje (45 tjedana). Procjena iz vaših unosa, ne ponuda.',
      use: 'Dodaj u poruku', used: 'Brojke su u poruci ispod.',
      line: 'Naša procjena: {p} ljudi troši oko {h} sati tjedno na ručne izvještaje ({now} sati godišnje). Automatizacija {s} toga vratila bi oko {saved} sati, odnosno {value} godišnje.'
    },
    story: {
      eyebrow: 'Vođeni demo', h2: 'Tjedan u tvrtki Nordvik.',
      lead: 'Nordvik Distribucija d.o.o. je izmišljeni veletrgovac opremom za grijanje, vodoinstalacije i elektroinstalacije. Pratite priču – svaki korak otvara demo na pravom zaslonu.',
      open: 'Otvori ovaj korak',
      items: [
        ['cashflow', '#/weeks', 'Prognoza likvidnosti', 'Sredinom prognoze novac padne ispod minimuma.', 'U 13-tjednoj prognozi stanje na računu sredinom razdoblja padne ispod sigurnosnog minimuma od 150.000 €. Prognoza pokazuje u kojem tjednu, zašto i što možete učiniti.'],
        ['collections', '#/', 'Potraživanja', 'Popis poziva za danas.', 'Potraživanja izdvajaju kupce koje danas vrijedi nazvati: najveći iznosi u kašnjenju, prekršena obećanja i opomene koje čekaju.'],
        ['collections', '#/promises', 'Potraživanja', 'Obećanje plaćanja.', 'Kupac obeća platiti do petka? Zabilježite datum i iznos, a aplikacija upozori kad obećanje istekne. U demu prognoza likvidnosti koristi iste račune i obećanja.'],
        ['budget', '#/comments', 'Plan i ostvarenje', 'Odstupanje koje treba objasniti.', 'Prihodi i troškovi koji odstupaju od plana čekaju komentar – i s komentarom idu u izvještaj za upravu.'],
        ['datacheck', '#/', 'Provjera podataka', 'Zašto uopće kašnjenja? Podaci.', 'Pogrešan OIB ili IBAN i duplikati kupaca znače odbijene eRačune i opomene na krivu adresu. Provjerite demo popis ili svoj.']
      ],
      note: 'Demo podaci su izmišljeni i ostaju u vašem pregledniku. Ništa se nikome ne šalje.'
    },
    built: { eyebrow: 'Izrađeno za klijente', h2: 'I još aplikacija za financije, prodaju i operativu.', lead: 'Sve počivaju na istom pristupu: vaš proces, vaši podaci, bez zamjene ERP-a. Pokažemo ih na sastanku.' },
    about: {
      eyebrow: 'O meni', h2: 'Iza tvrtke Clearfigure stojim ja.', photo: '[Fotografija]',
      bio: 'Gradim podatkovne platforme, Power BI izvještaje i poslovne aplikacije za financije, prodaju i operativu. Radim izravno s vama: od prve provjere podataka do aplikacije koju vaš tim koristi svaki dan.',
      bio2: 'Studirao sam na Ekonomskom fakultetu Sveučilišta u Ljubljani i radim kao podatkovni i BI analitičar te financijski kontroler (Python, SQL, BigQuery, Power BI). Zato pitanja financija poznajem iz prve ruke, a ne samo iz koda.',
      cases: 'Primjeri iz demo aplikacija', casesNote: 'Nordvik Distribucija d.o.o. izmišljena je tvrtka iz demo aplikacija; brojke izračunavaju same aplikacije na demo podacima. Studije slučaja stvarnih klijenata objavit ćemo uz njihovu suglasnost.',
      case1: { kicker: 'Primjer · izmišljena tvrtka, veleprodaja', title: 'Potraživanja i opomene', metrics: [['Otvorena potraživanja', '2.246.447 € kod 56 kupaca'], ['Dospjelo', '667.864 € (52 računa)'], ['Dani naplate (DSO)', '63 dana'], ['Na popisu za poziv danas', '24 kupca']], text: 'Aplikacija iz otvorenih računa sama sastavlja popis koga nazvati danas, izračunava zakonske zatezne kamate i priprema opomenu s HUB-3 / EPC QR kodom. Uplate iz bankovnog izvoda (camt.053) povezuje s računima po pozivu na broj.' },
      case2: { kicker: 'Primjer · popis kupaca iz starog ERP-a', title: 'Provjera i čišćenje podataka', metrics: [['Ocjena kvalitete podataka', '55 → 75'], ['Spremnost za eRačune', '55 % → 67 %'], ['Automatski ispravci', '1.131 u 420 redaka']], text: 'Datoteka s 420 kupaca: provjera OIB-a i PDV brojeva, IBAN-a, poštanskih brojeva i duplikata, zatim ispravci jednim klikom. Sve radi u pregledniku; datoteka ne napušta računalo.' },
    },
    faq: {
      eyebrow: 'Pitanja', h2: 'Dobro je znati.',
      items: [
        ['Gdje se spremaju podaci u demu?', 'Samo u vašem pregledniku (u pohrani ove stranice na vašem uređaju). Demo ne šalje podatke nama ni bilo kome drugome. Obrišete ih vraćanjem demo podataka u postavkama aplikacije ili brisanjem podataka ove stranice u pregledniku.'],
        ['Napušta li datoteka moje računalo pri provjeri podataka?', 'Ne. Datoteku čita i provjerava vaš preglednik, ne učitava se na poslužitelj. Za čitanje Excel datoteka stranica pri prvoj upotrebi učita biblioteku SheetJS s cdnjs.cloudflare.com; vaša datoteka pritom ne putuje nikamo. Online provjera PDV ID-a u sustavu VIES na ovoj stranici nije dostupna – radimo je u plaćenom izvještaju.'],
        ['Što se događa s porukom iz obrasca?', 'Spremamo je kako bismo vam mogli odgovoriti: ime, tvrtka, e-adresa, telefon ako ga upišete i poruka. Pojedinosti su u <a href="/zasebnost/">izjavi o privatnosti</a> (na slovenskom).'],
        ['Gdje će biti podaci kad alat koristimo za svoju tvrtku?', 'To dogovorimo prije početka: gdje aplikacija radi i gdje se podaci spremaju, tko ima pristup te kako dobivate izvoz ili sigurnosnu kopiju. Zapišemo to u ugovor i ugovor o obradi osobnih podataka.'],
        ['Moramo li zamijeniti ERP?', 'Ne. Alati čitaju izvoze iz Minimaxa, Pantheona ili Excela (CSV) i bankovne izvode (camt.053); pri postavljanju mapiramo vaše stupce. Vaš ERP ostaje glavni sustav.'],
        ['Što točno postaje obvezno kod eRačuna?', 'U Hrvatskoj od ' + d(HR_DATE) + ' obveznici PDV-a međusobno razmjenjuju eRačune u formatu UBL 2.1 putem informacijskih posrednika, uz fiskalizaciju i KPD šifru na svakoj stavci; od 1. 1. 2027. to vrijedi i za tvrtke izvan sustava PDV-a. U Sloveniji od ' + d(SI_DATE) + ' svi poslovni subjekti međusobno razmjenjuju samo strukturirane eRačune (e-SLOG ili EN 16931) – putem pružatelja usluga, mreže Peppol ili izravno. Ovo je sažetak, a ne pravni savjet.'],
        ['Mogu li paket otkazati u bilo kojem trenutku?', 'Da. Mjesečni paketi otkazuju se za sljedeći mjesec; nema dugoročne obveze.'],
        ['Je li izračun kamata u opomenama pravni savjet?', 'Ne. Zakonske zatezne kamate, naknada od 40 € i tekstovi opomena zadane su postavke koje pri postavljanju provjerimo s vama. Za sudsku naplatu trebate odvjetnika.'],
        ['Koristi li stranica kolačiće ili alate za praćenje?', 'Ne. Nema kolačića, nema analitike i nema vanjskih fontova. Demo aplikacije spremaju samo vaš rad u pregledniku na vašem uređaju.']
      ]
    },
    contact: {
      eyebrow: 'Kontakt', h2: 'Recite gdje ste. Predložit ćemo gdje početi.', lead: 'Odgovaram osobno.',
      name: 'Ime i prezime', company: 'Tvrtka', email: 'E-pošta', phone: 'Telefon', optional: 'neobavezno', product: 'Što vas zanima', message: 'Poruka',
      placeholder: 'Koji ERP koristite, koliko kupaca i računa imate mjesečno, što vas najviše muči …',
      options: { datacheck: 'Provjera i čišćenje podataka', einvoice: 'eRačuni', collections: 'Potraživanja i opomene', cashflow: 'Prognoza likvidnosti', budget: 'Plan i ostvarenje', custom: 'Aplikacija po mjeri', other: 'Nešto drugo' },
      honeypot: 'Ovo polje ne ispunjavajte',
      submit: 'Pošalji poruku', sending: 'Šaljem …',
      privacy: 'Podatke iz obrasca koristimo samo za odgovor na vašu poruku. Više u <a href="/zasebnost/">izjavi o privatnosti</a> (na slovenskom).',
      side: 'Radije uživo?', sideText: '20 minuta, bez obveze: recite što vas muči i predložit ću prvi korak.', book: 'Rezervirajte 20 minuta', orWrite: 'ili pišite na',
      bookSubject: 'Termin za razgovor od 20 minuta', mailSubject: 'Upit s web stranice',
      msg: {
        ok: 'Hvala, poruka je primljena. Odgovorit ću vam na navedenu e-adresu.',
        invalid: 'Provjerite označena polja.',
        tooFast: 'Pričekajte trenutak i pokušajte ponovno.',
        rate: 'Već ste poslali nekoliko poruka. Pokušajte ponovno za sat vremena ili pišite e-poštom.',
        fail: 'Poruku sada nije bilo moguće poslati.', mailto: 'Pošaljite je e-poštom',
        name: 'Upišite ime (2–100 znakova).', email: 'Upišite ispravnu e-adresu.', phone: 'Telefon smije sadržavati znamenke, razmake i znakove + ( ) / - .', message: 'Napišite barem nekoliko riječi (10–4.000 znakova).', company: 'Najviše 120 znakova.'
      }
    },
    footer: {
      tagline: 'Clearfigure – podaci, analitika i poslovne aplikacije za slovenske i hrvatske tvrtke.',
      privacy: 'Privatnost', legal: 'Pravna obavijest', contact: 'Kontakt', demoNote: 'Svi podaci u demo aplikacijama su izmišljeni.',
      reg: 'Matični broj', tax: 'Porezni broj', capital: 'Temeljni kapital', legalLang: ' (na slovenskom)'
    }
  };
}

// ── English ────────────────────────────────────────────────────────────────────────────────────────────────────────
function en(P, C, e, d) {
  const mo = (n) => e(n) + '/month', from = (n) => 'from ' + e(n);
  return {
    locale: 'en-GB',
    title: 'Clearfigure – e-invoice readiness, collections, cash forecast and budgets',
    description: 'We check and clean your master data before mandatory e-invoicing (Croatia since 1 January 2026, Slovenia from 1 January 2028) and set up tools for collections, cash forecasting and budgets.',
    skip: 'Skip to content',
    nav: { einv: 'E-invoices', products: 'Packages', demo: 'Demo', about: 'About', faq: 'FAQ', contact: 'Contact', cta: 'Get in touch', menu: 'Menu', lang: 'Language' },
    hero: {
      eyebrow: 'Mandatory e-invoices: Croatia since ' + d(HR_DATE) + ' · Slovenia from ' + d(SI_DATE),
      h1: 'Get your data ready for mandatory <span class="grad">e-invoices</span>.',
      lead: 'We check and clean your master data – VAT IDs, IBANs, addresses and duplicates –, connect your ERP to e-invoice exchange and give you tools for collections, cash and budgets. For Slovenian and Croatian companies.',
      cta1: 'Free data health check', cta2: 'Book 20 minutes',
      note: 'The check runs in your browser: your file never leaves your computer.'
    },
    deadlines: {
      label: 'E-invoice deadlines',
      hr: { kicker: 'Croatia · Fiscalisation 2.0', when: d(HR_DATE), status: 'in force', text: 'VAT-registered businesses issue and receive B2B e-invoices (UBL 2.1) with fiscalisation. Every line needs a KPD 2025 code, and payments on issued e-invoices are reported monthly. From 1 January 2027 also for businesses outside the VAT system.' },
      si: { kicker: 'Slovenia · ZIERDED', when: d(SI_DATE), status: ['in {n} day', 'in {n} days'], text: 'Every company and sole trader in the Slovenian Business Register will exchange only structured e-invoices with each other (e-SLOG or EN 16931, e.g. via Peppol). A PDF by e-mail will no longer do.' },
      foot: 'A summary of the rules, not legal advice.'
    },
    steps: {
      eyebrow: 'In three steps', h2: 'From a data check to e-invoices your partners accept.',
      items: [
        ['Data health check', 'Upload a customer, supplier or product list. In minutes you see invalid VAT IDs, IBANs, OIBs, postcodes, duplicates and an e-invoice readiness score.', 'Self-check free · report with a call ' + e(P.datacheck.report)],
        ['Master-data clean-up', 'We fix VAT IDs, IBANs, addresses and duplicates, add KPD codes for Croatia and prepare an import file for Minimax or Pantheon. At the end: a before and after score.', from(P.datacheck.cleanupFrom)],
        ['E-invoice connection', 'We connect your ERP export to your e-invoice provider (e-SLOG, UBL, Peppol) and test everything with three key partners.', from(P.einvoice.connectionFrom)]
      ],
      bundle: 'Readiness bundle: all three steps for <b>' + e(P.einvoice.readinessBundle) + '</b> instead of ' + e(P.einvoice.readinessInsteadOf) + '. Support after go-live ' + mo(P.einvoice.supportMonthly) + '.',
      cta: 'Start with step 1'
    },
    products: {
      eyebrow: 'Packages and prices', h2: 'Four tools. Try them now.',
      lead: 'Each tool opens on a fictional company, Nordvik Distribucija d.o.o. For your company we set it up on your own data from Minimax, Pantheon or Excel.',
      open: 'Open the demo', ask: 'Ask about it', tagFree: 'Free to start',
      items: {
        datacheck: { name: 'Data health check', text: 'Checks a customer, supplier or product list: VAT IDs (SI/HR), OIB, IBAN, EAN, e-mail, phone, postcodes and duplicates – and gives you a cleaned file back.', rows: [['Online self-check', 'free'], ['Report and a 45-minute call', e(P.datacheck.report)], ['Clean-up before e-invoicing', from(P.datacheck.cleanupFrom)]], small: 'The report covers up to three lists and 20,000 rows and is credited in full if you order the clean-up within ' + P.datacheck.reportCreditDays + ' days. Clean-up up to 10,000 partners and 10,000 products: ' + e(P.datacheck.cleanupLarge) + '.' },
        collections: { name: 'Collections', text: 'Who owes you, who to call today, and the reminder letter with statutory late-payment interest, the €40 fee and a payment QR code – in Slovenian, Croatian or English.', rows: [['Setup', e(P.collections.setup)], ['Monthly, up to ' + P.collections.users + ' users', mo(P.collections.monthly)]], small: 'Extra user ' + mo(P.collections.extraUser) + '. Annual billing ' + e(P.collections.annual) + ' (two months free). Setup includes importing your open items, letter templates with your logo and a one-hour training.' },
        cashflow: { name: 'Cash forecast (13 weeks)', text: 'See week by week how much cash you will have in the bank and spot a gap early – with scenarios and suggestions what to do.', rows: [['Setup', e(P.cashflow.setup)], ['Monthly', mo(P.cashflow.monthly)], ['With a review every two weeks', mo(P.cashflow.reviewMonthly)]], small: 'Review: a one-hour call every two weeks and a short note to the director. Setup includes the import from your ERP, opening balances from the bank statement and a first forecast built together.' },
        budget: { name: 'Budget vs actual', text: 'Budget and actuals by account, cost centre and month, the variances that need an explanation, an EBITDA bridge and a monthly board pack in English, Slovenian or Croatian.', rows: [['Setup', e(P.budget.setup)], ['Monthly', mo(P.budget.monthly)], ['Board pack prepared for you', mo(P.budget.preparedMonthly)]], small: 'Setup includes mapping your chart of accounts, importing the budget from Excel and two monthly closes done together.' }
      },
      bundle: '<b>Cash bundle:</b> Collections and Cash forecast on the same data – setup ' + e(P.bundle.setup) + ', ' + mo(P.bundle.monthly) + '.',
      custom: '<b>Custom apps:</b> ' + e(P.custom.dayRate) + ' a day, or a fixed price after a paid scoping (' + e(P.custom.scoping) + ', credited against the project).',
      founding: '<b>First ' + P.founding.customers + ' customers:</b> ' + P.founding.setupDiscountPct + ' % off the setup in return for a case study (named or anonymous).',
      terms: 'Monthly plans can be cancelled every month. ' + C.vatNote.en
    },
    calc: {
      eyebrow: 'Calculator', h2: 'What is manual work costing you?',
      lead: 'Copying exports, fixing formulas, rebuilding the same report every Monday. Put in your numbers and see what automation would give back each year.',
      people: 'People who build reports or copy data by hand', hours: 'Hours a week per person', rate: 'Cost per hour, salary and overheads', share: 'Share of that work that can be automated',
      back: 'Back every year', hoursLine: '{saved} hours a year, from {now} hours of manual work', now: 'Today', after: 'Automated',
      fte: 'full-time people’s worth of time', weeks: 'working weeks back per person per year',
      note: 'A 40-hour week and 1,800 working hours a year (45 weeks). An estimate from your inputs, not a quote.',
      use: 'Add to my message', used: 'Your numbers are in the message below.',
      line: 'Our estimate: {p} people spend about {h} hours a week each on manual reports ({now} hours a year). Automating {s} of that would give back about {saved} hours, roughly {value} a year.'
    },
    story: {
      eyebrow: 'Guided demo', h2: 'A week at Nordvik.',
      lead: 'Nordvik Distribucija d.o.o. is a fictional wholesaler of heating, plumbing and electrical supplies. Follow the story – each step opens the demo on the right screen.',
      open: 'Open this step',
      items: [
        ['cashflow', '#/weeks', 'Cash forecast', 'Mid-forecast, cash dips below the minimum.', 'In the 13-week forecast the bank balance falls below the 150,000 € safety minimum halfway through. The forecast shows which week, why, and what you can do.'],
        ['collections', '#/', 'Collections', 'Today’s call list.', 'Collections picks the customers worth calling today: the largest overdue amounts, broken promises and letters waiting to go out.'],
        ['collections', '#/promises', 'Collections', 'A promise to pay.', 'A customer promises to pay by Friday? Note the date and amount, and the app tells you when the promise lapses. In the demo, the cash forecast uses the same invoices and promises.'],
        ['budget', '#/comments', 'Budget vs actual', 'A variance that needs an explanation.', 'Revenue and costs that are off budget wait for a comment – and go into the board pack with it.'],
        ['datacheck', '#/', 'Data health check', 'Why are payments late at all? Data.', 'A wrong VAT ID or IBAN and duplicate customers mean rejected e-invoices and reminders sent to the wrong address. Check the demo list or your own.']
      ],
      note: 'The demo data is fictional and stays in your browser. Nothing is sent to anyone.'
    },
    built: { eyebrow: 'Built for clients', h2: 'And more apps for finance, sales and operations.', lead: 'All built the same way: your process, your data, no ERP replacement. We show them in a meeting.' },
    about: {
      eyebrow: 'About', h2: 'Clearfigure is me.', photo: '[Photo]',
      bio: 'I build data platforms, Power BI reports and business apps for finance, sales and operations. You work with me directly: from the first data check to the app your team uses every day.',
      bio2: 'I studied at the School of Economics and Business, University of Ljubljana, and work as a data & BI analyst and financial controller (Python, SQL, BigQuery, Power BI). So I know finance questions first-hand, not just from code.',
      cases: 'Examples from the demo apps', casesNote: 'Nordvik Distribucija d.o.o. is a fictional company from the demo apps; the apps calculate these figures themselves from the demo data. Case studies of real clients will be published with their consent.',
      case1: { kicker: 'Example · fictional wholesaler', title: 'Collections', metrics: [['Open receivables', '€2,246,447 across 56 customers'], ['Overdue', '€667,864 (52 invoices)'], ['Days sales outstanding (DSO)', '63 days'], ['On today’s call list', '24 customers']], text: 'From the open invoices the app builds the list of who to call today, calculates statutory default interest and prepares the reminder with a UPN/EPC QR code. Payments from the bank statement (camt.053) are matched to invoices by reference.' },
      case2: { kicker: 'Example · customer list from an old ERP', title: 'Data check and clean-up', metrics: [['Data quality score', '55 → 75'], ['E-invoice readiness', '55% → 67%'], ['One-click fixes', '1,131 in 420 rows']], text: 'A file of 420 customers: VAT IDs, IBANs, postcodes and duplicates checked, then fixed with one click. Everything runs in the browser; the file never leaves the computer.' },
    },
    faq: {
      eyebrow: 'FAQ', h2: 'Good to know.',
      items: [
        ['Where is the demo data stored?', 'Only in your browser (in this site’s storage on your device). The demos send nothing to us or anyone else. Clear it with the reset in each app’s settings, or by clearing this site’s data in your browser.'],
        ['Does my file leave my computer in the data health check?', 'No. Your browser reads and checks the file; it is never uploaded. To read Excel files the page loads the SheetJS library from cdnjs.cloudflare.com the first time; your file goes nowhere. The online VIES VAT check is not available on this site – we run it in the paid report.'],
        ['What happens to the message I send with the form?', 'We store it so we can reply: your name, company, e-mail, phone if you give one, and the message. Details are in the <a href="/zasebnost/">privacy notice</a> (in Slovenian).'],
        ['Where will our data be once we use a tool for our company?', 'We agree that before we start: where the app runs and where the data is stored, who has access, and how you get an export or backup. It goes into the contract and a data processing agreement.'],
        ['Do we have to replace our ERP?', 'No. The tools read exports from Minimax, Pantheon or Excel (CSV) and bank statements (camt.053); during setup we map your columns. Your ERP stays the main system.'],
        ['What exactly becomes mandatory with e-invoices?', 'In Croatia, since ' + d(HR_DATE) + ', VAT-registered businesses exchange e-invoices in UBL 2.1 through information intermediaries, with fiscalisation and a KPD code on every line; from 1 January 2027 this also applies to businesses outside the VAT system. In Slovenia, from ' + d(SI_DATE) + ', all businesses exchange only structured e-invoices with each other (e-SLOG or EN 16931) – through providers, the Peppol network or directly. This is a summary, not legal advice.'],
        ['Can I cancel at any time?', 'Yes. Monthly plans are cancelled for the following month; there is no long-term commitment.'],
        ['Is the interest calculation in the reminder letters legal advice?', 'No. Statutory interest, the €40 fee and the letter wording are defaults we check with you during setup. For court enforcement you need a lawyer.'],
        ['Does this site use cookies or trackers?', 'No. No cookies, no analytics and no external fonts. The demo apps only keep your work in the browser on your device.']
      ]
    },
    contact: {
      eyebrow: 'Contact', h2: 'Tell us where you are. We’ll suggest where to start.', lead: 'I answer personally.',
      name: 'Name', company: 'Company', email: 'E-mail', phone: 'Phone', optional: 'optional', product: 'What are you interested in', message: 'Message',
      placeholder: 'Which ERP you use, how many customers and invoices a month, what bothers you most …',
      options: { datacheck: 'Data check and clean-up', einvoice: 'E-invoices', collections: 'Collections', cashflow: 'Cash forecast', budget: 'Budget vs actual', custom: 'A custom app', other: 'Something else' },
      honeypot: 'Leave this field empty',
      submit: 'Send message', sending: 'Sending …',
      privacy: 'We use the details in this form only to reply to your message. More in the <a href="/zasebnost/">privacy notice</a> (in Slovenian).',
      side: 'Rather talk?', sideText: '20 minutes, no obligation: tell me what hurts and I’ll suggest a first step.', book: 'Book 20 minutes', orWrite: 'or write to',
      bookSubject: 'A 20-minute call', mailSubject: 'Enquiry from the website',
      msg: {
        ok: 'Thank you, your message has arrived. I’ll reply to the e-mail address you gave.',
        invalid: 'Please check the highlighted fields.',
        tooFast: 'Please wait a moment and try again.',
        rate: 'You have already sent several messages. Please try again in an hour or write by e-mail.',
        fail: 'The message could not be sent right now.', mailto: 'Send it by e-mail',
        name: 'Enter your name (2–100 characters).', email: 'Enter a valid e-mail address.', phone: 'A phone number may contain digits, spaces and + ( ) / - .', message: 'Write at least a few words (10–4,000 characters).', company: 'At most 120 characters.'
      }
    },
    footer: {
      tagline: 'Clearfigure – data, analytics and business apps for Slovenian and Croatian companies.',
      privacy: 'Privacy', legal: 'Legal notice', contact: 'Contact', demoNote: 'All data in the demo apps is fictional.',
      reg: 'Registration no.', tax: 'Tax no.', capital: 'Share capital', legalLang: ' (in Slovenian)'
    }
  };
}
