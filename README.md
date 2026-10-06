# Felis

Un simulatore di gatto con vista laterale: silhouette scura, paesaggio chiaro, nebbia e una radura da esplorare liberamente. Il mondo, il gatto e le animazioni sono disegnati in Canvas 2D; i caratteri vengono serviti localmente. Non occorrono account, chiavi API o servizi esterni durante il gioco.

## Avvio

Richiede Node.js 22.12 o successivo; ambiente verificato con Node.js 24.

```sh
cd /workspace/gatto
npm ci --cache /tmp/felis-npm-cache
npm run dev -- --port 3000
```

Apri la porta 3000 nell’ambiente di sviluppo. Per compilare il sito statico usa `npm run build`; i file pronti per la distribuzione si trovano in `dist/`. `npm run preview -- --port 3000` serve la compilazione per una verifica locale.

## Comandi

| Comando | Azione |
| --- | --- |
| ← / → | Cammina nelle due direzioni |
| A + ← / → | Corri, tenendo premuto A |
| S | Salta; tenendolo premuto il salto è più alto |
| X | Mostra o nasconde lo scheletro |
| Spazio | Pausa / riprendi |
| R | Torna all’inizio |

I comandi sullo schermo supportano pressione prolungata e multitocco. Il pulsante audio attiva vento e passi sintetizzati, inizialmente disattivati. Il pulsante `?` mostra le istruzioni. La simulazione si mette in pausa quando la pagina passa in background.

## Movimento e anatomia

La fisica procede a intervalli fissi di 1/120 di secondo, indipendentemente dal refresh del monitor. Il corpo ha accelerazione limitata, inerzia, attrito sul terreno, minore controllo in aria, gravità e impatto di atterraggio. La pressione di S viene memorizzata brevemente per rendere affidabile il salto vicino al contatto con il terreno; non si può saltare ripetutamente in aria.

Quattro zampe usano cinematica inversa, con spalla/anca, gomito/ginocchio, polso/garretto e zampa. Durante l’appoggio il piede resta ancorato al mondo; durante il recupero segue un arco verso il nuovo contatto. Velocità e distanza percorsa determinano passo, trotto e galoppo. Colonna, testa e coda reagiscono all’andatura, all’accelerazione e al salto. Le articolazioni della coda usano molle smorzate; l’atterraggio comprime il corpo prima del ritorno all’equilibrio.

È una simulazione procedurale per un gioco: anatomia e dinamica sono approssimate, senza un modello biomeccanico veterinario o dinamica indipendente di ogni osso. Le unità interne sono coordinate del mondo; la velocità visualizzata usa 150 unità per metro.

## Verifiche

```sh
npm test
npm run build
```

I test verificano accelerazione, frenata, inversione, salto, contatto con il suolo e integrità dello scheletro. Nel browser è disponibile `window.felis.getState()`, una fotografia dello stato per ispezione e smoke test. La verifica funzionale usa i comandi reali della pagina, anche in formato mobile.

Con il server avviato, `npm run test:browser` esegue i controlli funzionali di tastiera, interfaccia, layout mobile e multitocco con Playwright e il Chromium di sistema (`/usr/bin/chromium`). Puoi impostare `FELIS_CHROMIUM` per usare un altro eseguibile, `FELIS_URL` per un’altra porta o `FELIS_ARTIFACT_DIR` per salvare gli screenshot.

## File principali

- `src/cat.js`: massa del corpo, movimento, scheletro, cinematica inversa e silhouette.
- `src/world.js`: terreno, parallax, alberi, nebbia, erba e polvere.
- `src/main.js`: ciclo a intervalli fissi, tastiera, multitocco, camera e interfaccia.
- `src/audio.js`: suoni ambientali e passi, senza file audio esterni.
- `src/style.css`: interfaccia adattiva e riduzione dei movimenti decorativi.

Ogni task cloud è già isolato: riutilizza questo checkout, senza creare ulteriori worktree a meno che non siano richiesti esplicitamente.
