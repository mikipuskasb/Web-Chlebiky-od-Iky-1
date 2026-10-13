# Chlebíky od Iky

Funkčný objednávkový systém pre týždenné pečenie. Bez online platieb. Slovenské rozhranie funguje na mobile aj počítači; ponuky, účty a objednávky sú uložené v databáze SQLite.

## Ako ho používa Ika

1. Otvorí `/admin` a zadá svoj prístupový kľúč.
2. Klikne **Nová ponuka**. Dátum sa predvyplní na najbližšiu stredu podľa slovenského času. Zadá názov, popis vrátane zloženia a alergénov, cenu za kus a počet kusov pri každom výrobku.
3. Uloží rozpracovanú ponuku, skontroluje ju a klikne **Zverejniť a získať odkaz**.
4. Skopíruje odkaz alebo klikne **Správa do WhatsApp**. Hotovú správu môže skopírovať alebo otvoriť vo WhatsApp a sama vybrať skupinu. Web správy neposiela automaticky.
5. V správe vidí tabuľku **Kto si čo objednal** a tabuľku **Čo sa objednalo a čo zostáva**. Obe môže stiahnuť do CSV; objednávky môže vytlačiť. Tlač používa zobrazenú ponuku.
6. Pred pečením klikne **Uzavrieť objednávanie**. Ďalší utorok môže vytvoriť novú ponuku alebo použiť **Použiť na ďalší týždeň** a upraviť skopírované výrobky.

Zverejnenie novej ponuky automaticky uzavrie predchádzajúcu. Staré objednávky a súhrny zostávajú v archíve. Zverejnená ponuka má uzamknuté ceny, výrobky a kapacity, aby sa nezmenili údaje už uložených objednávok. Ponuku treba publikovať ručne; dátum sám objednávanie neuzatvára.

## Ako objednáva člen skupiny

Člen otvorí týždenný odkaz. Pri prvej návšteve si vytvorí účet so svojím menom, telefónom a heslom; ďalšie týždne používa ten istý účet. Prihlásenie si prehliadač pamätá najviac 30 dní.

Vyberie počty a klikne **Uložiť moju objednávku**. Každý účet má pre ponuku jednu objednávku. Do uzavretia ju môže upraviť alebo zrušiť. Uloženie nahradí predchádzajúci výber a cena sa vždy vypočíta na serveri.

Server odvodzuje objednávajúceho z prihláseného účtu; neprijíma meno ani identifikátor iného zákazníka. Transakcia v databáze bráni predaju nad dostupné počty aj pri súčasných požiadavkách. Zákazník vidí svoj výber a dostupnosť, nie údaje ostatných ľudí. Dostupnosť sa obnovuje každých 20 sekúnd, dá sa obnoviť ručne a vždy sa overí pri ukladaní.

Odkaz má náhodný identifikátor a slúži ako pozvánka. Web nemá prístup k zoznamu členov WhatsApp skupiny a neoveruje vlastníctvo telefónu cez SMS. Kto dostane preposlaný odkaz, môže si vytvoriť účet. Heslo chráni existujúci účet a jeho objednávky. Zabudnuté heslo môže Ika obnoviť cez **Členovia a heslá** po overení totožnosti v skupine; zrušia sa tým predchádzajúce prihlásenia.

## Vývoj

Potrebný je **Node.js 24 alebo novší**. SQLite je súčasťou Node.js; samostatný databázový server sa neinštaluje.

```sh
npm ci
npm run dev
```

Vite spúšťa frontend na porte `5173`, API na `3001`. Otvorte web na porte `5173`; API smeruje cez Vite proxy. Spúšťajte príkazy z koreňa repozitára. Po ukončení vývojového príkazu sa ukončia oba procesy.

V cloudovom prostredí s nezapisovateľným domovským priečinkom použite:

```sh
npm --cache /workspace/.npm-cache ci
```

Pri prvom štarte sa vytvorí priečinok `.data/`, databáza a náhodný prístupový kľúč v `.data/admin-token`. Tento súbor je určený iba prevádzkovateľovi. Pre prihlásenie Iky použite jeho obsah; nevkladajte ho do kódu, verejného odkazu ani WhatsApp skupiny. Dá sa nahradiť premennou `ADMIN_TOKEN` s aspoň 16 znakmi. Kľúč sa pri opakovanom štarte nemení.

Na začiatku nie sú založené ukážkové ponuky ani zákazníci. Ika vytvorí prvú skutočnú ponuku v administrácii.

## Overenie

```sh
npm test
npm run test:browser
```

API testy používajú izolované dočasné databázy a overujú autorizáciu, súbežné rezervácie posledného kusu, nahradenie objednávky, zrušenie, týždenné archívy, obnovu hesla a zachovanie údajov po reštarte. Testy v Chromium prejdú skutočné formuláre, oba prehľady, export, mobilné rozhranie a bezpečné zobrazenie používateľského textu.

Prehliadačové testy používajú `/usr/bin/chromium`, ak existuje, alebo vlastný `CHROMIUM_PATH`. Inak nainštalujte prehliadač Playwright cez `npx playwright install chromium`. `npm run test:browser` najprv vytvorí produkčný build. Testy nevytvárajú objednávky v skutočnej databáze `.data/`.

## Produkčné spustenie

### Živá skúšobná verzia cez Render

Súbor `render.yaml` pripravuje bezplatnú skúšobnú službu s funkčným webom aj API. Po nahratí kódu na GitHub v Renderi vytvorte **Blueprint**, pripojte tento repozitár a vyberte vetvu obsahujúcu `render.yaml`. Render zostaví aplikáciu a pridelí verejnú HTTPS adresu. Na nej môžete kliknúť na **Vstup pre Iku**, vytvoriť ponuku, otvoriť jej odkaz a otestovať objednávanie ako zákazník.

Render vygeneruje `ADMIN_TOKEN`; svoj prístupový kľúč nájdete v nastaveniach premenných služby na Renderi. Zadáva sa iba do administrácie na `/admin`. Nezdieľajte ho verejne ani v skupine.

Táto bezplatná verzia slúži na skúšanie: databáza na dočasnom disku sa pri novom nasadení či reštarte môže vymazať a neaktívna služba môže zaspávať. Pre skutočné objednávky treba službu s trvalým diskom, pripojeným napríklad na `/var/data`, a `DATA_DIR=/var/data/chlebiky`. Hosting nie je nastavením cloudového vývojového prostredia automaticky pripojený.

### Vlastný server alebo hosting

```sh
npm ci
npm run build
npm start
```

Produkčný server na porte `3000` obsluhuje web aj API. Hosting musí podporovať **trvalo bežiaci Node.js proces a zapisovateľný trvalý disk**. Samotný statický hosting nestačí. Verejnú doménu pripojte cez HTTPS; odkaz do WhatsApp sa vytvára z adresy, na ktorej má Ika administráciu otvorenú.

| Premenná        | Význam                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`          | Port servera; predvolene `3000`.                                                                                                 |
| `DATA_DIR`      | Trvalý priečinok databázy a lokálneho kľúča; predvolene `.data/`.                                                                |
| `ADMIN_TOKEN`   | Voliteľný tajný prístupový kľúč Iky. Ak chýba, vygeneruje sa do `DATA_DIR/admin-token`.                                          |
| `COOKIE_SECURE` | Pri verejnom HTTPS nastaviť `true`, aby sa prihlásenie prenášalo iba cez HTTPS. Pri lokálnom HTTP nechať vypnuté.                |
| `TRUST_PROXY`   | Nastaviť `true` iba za dôveryhodnou proxy, ktorá sama nastavuje `X-Forwarded-For`. Umožní obmedzenie pokusov podľa IP zákazníka. |

Proxy má zachovať pôvodnú hlavičku `Host`; kontrola pôvodu požiadaviek používa tento údaj. Pri `TRUST_PROXY=true` nesmie byť Node server dostupný mimo dôveryhodnej proxy. Pre verejnú prevádzku nastavte aj časový plán záloh trvalých údajov. Jednoduchá konzistentná záloha je kópia celého `DATA_DIR` pri zastavenom serveri; záloha obsahuje aj prístupový kľúč a musí zostať súkromná.

Priložený `Dockerfile` vytvára produkčný obraz. Zostavenie: `docker build -t chlebiky-od-iky .`. Pri spustení pripojte trvalý volume na `/data` a nastavte verejnú HTTPS proxy. Docker obraz má `COOKIE_SECURE=true`; na čisto lokálny HTTP test túto hodnotu prepnite na `false`. Docker zostavenie nebolo v tomto cloudovom prostredí overené.

## Súbory

- `server.mjs`: HTTP API, účty, prihlasovanie, ponuky, SQLite a rezervácie.
- `src/main.js`: zákaznícke rozhranie a administrácia Iky.
- `src/style.css`, `public/bread.svg`: responzívny vzhľad a vlastná ilustrácia.
- `tests/`: funkčné testy API a prehliadača.

Uloženie cloudovej konfigurácie pripravuje vývojové prostredie; neznamená verejné nasadenie webu.
