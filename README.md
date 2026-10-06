# Felis — il piccolo cacciatore

Un piccolo gatto in un salotto chiuso, con vista laterale e grafica vettoriale: cammina, corre, frena e salta sui mobili per raggiungere un puntino laser rosso. Puoi guidarlo oppure attivare l’inseguimento automatico. Il gioco usa Canvas 2D e caratteri locali; non richiede account o servizi esterni durante la partita.

## Giocare online

Il sito compilato si trova nel branch `gh-pages`. Per pubblicarlo, apri [Settings → Pages](https://github.com/der1988/gatto/settings/pages), scegli **Deploy from a branch**, branch **gh-pages**, cartella **/ (root)** e salva. GitHub mostra il collegamento al gioco quando termina la distribuzione.

```sh
npm run publish:pages
```

Questo comando esegue i test, compila con il percorso `/gatto/` e aggiorna il branch `gh-pages`, mantenendo il checkout e la cronologia di `main`. L’attivazione iniziale di Pages richiede i permessi di amministrazione Pages del repository.

## Avvio locale

Richiede Node.js 22.12 o successivo; ambiente verificato con Node.js 24.

```sh
cd /workspace/gatto
npm ci --cache /tmp/felis-npm-cache
npm run dev -- --port 3000
```

Per compilare usa `npm run build`; il sito statico viene generato in `dist/`. `npm run preview` serve la compilazione per una verifica locale. Per provare il percorso usato da GitHub Pages:

```sh
FELIS_BASE_PATH=/gatto/ npm run build
FELIS_BASE_PATH=/gatto/ npm run preview -- --port 3001
```

La pagina della compilazione si trova nel percorso `/gatto/`.

## Comandi

| Comando | Azione |
| --- | --- |
| ← / → | Cammina nelle due direzioni |
| A + ← / → | Corri, tenendo premuto A |
| S | Salta; tenendolo premuto il salto è più alto |
| Clic / tocco nella stanza | Sposta il laser sul pavimento o sul mobile |
| I / pulsante «segui il laser» | Attiva o ferma l’inseguimento automatico |
| X | Mostra o nasconde lo scheletro |
| Spazio | Pausa / riprendi |
| R | Ricomincia |

Frecce e S riprendono immediatamente il controllo manuale. I pulsanti sullo schermo supportano pressione prolungata e multitocco. Quando il gatto raggiunge il laser, guadagna un punto e il puntino si sposta. L’inseguimento automatico usa gli stessi comandi e la stessa fisica del giocatore, compresi i salti sui mobili.

L’audio opzionale genera ambiente e passi sincronizzati con gli appoggi delle zampe. Il pulsante `?` mostra le istruzioni. La simulazione si mette in pausa quando la pagina passa in background.

## Animazioni e fisica

Il gatto è ridotto al 60% della dimensione originale. Camminata e frenata ricostruiscono rispettivamente otto e dieci pose del riferimento illustrato; il galoppo interpola dodici pose ricavate dalla sequenza fotografica. Le transizioni mescolano progressivamente le posture senza azzerare il ciclo del passo.

Quattro zampe usano cinematica inversa e ossa di lunghezza costante. Durante l’appoggio il piede resta ancorato al mondo; durante il recupero segue un arco verso il nuovo contatto. Schiena, testa e coda seguono il movimento. Il salto distingue slancio, salita, raccoglimento all’apice, preparazione al contatto e compressione di atterraggio. Dopo l’assestamento, il corpo fermo resta immobile e si muove soltanto la coda.

La fisica procede a intervalli fissi di 1/120 di secondo: accelerazione, inerzia, frenata decisa, inversione, controllo ridotto in aria, gravità e atterraggio. Pareti e soffitto delimitano il salotto; divano, pouf e mobile hanno superfici e lati solidi. Il gatto può saltarci sopra e cadere dal bordo.

Anatomia e dinamica sono approssimazioni procedurali per un gioco. Le unità interne sono coordinate del mondo; la velocità visualizzata usa 150 unità per metro.

## Verifiche

```sh
npm test
npm run build
```

I test verificano movimento, frenata, inversione, salto, integrità dello scheletro, transizioni, immobilità a riposo, collisioni e raggiungibilità degli obiettivi laser con la fisica reale.

Con il server avviato, `npm run test:browser` verifica tastiera, interfaccia, inseguimento, salti sui mobili, layout mobile e multitocco con Playwright e Chromium (`/usr/bin/chromium`). Puoi impostare `FELIS_CHROMIUM`, `FELIS_URL` e `FELIS_ARTIFACT_DIR` per cambiare eseguibile, indirizzo e cartella degli screenshot. Nel browser `window.felis.getState()` e `window.felis.getRig()` consentono l’ispezione dello stato e dello scheletro.

## File principali

- `src/cat.js`: movimento, scheletro e cinematica inversa.
- `src/reference-motion.js`: pose di camminata, galoppo e frenata, con interpolazione.
- `src/cat-renderer.js`: silhouette anatomica e scheletro, disegnati dalla stessa posa.
- `src/room.js`: salotto, collisioni, mobili, laser e inseguimento.
- `src/main.js`: ciclo a intervalli fissi, comandi, camera e interfaccia.
- `src/audio.js`: ambiente e passi sintetizzati.
- `scripts/publish-pages.mjs`: compilazione e caricamento del sito statico su GitHub.

Ogni task cloud è già isolato: riutilizza questo checkout senza creare ulteriori worktree, salvo richiesta esplicita.
