# Plan de projet — Pipeline Événements → Expedia → Réseaux sociaux

**Nom de code :** `genia-travel-bot`
**Stack retenue :** Node.js 20+ / TypeScript / PostgreSQL / Redis
**Version du plan :** 1.0

> Stack modifiable. Si tu préfères Python (FastAPI + Celery), l'architecture reste identique — seuls les noms de librairies changent.

---

## 1. Vision en une phrase

Un agent détecte des événements majeurs, génère un lien de voyage Expedia affilié et traçable vers cette ville, et publie automatiquement l'annonce sur Facebook et Instagram — avec mesure de conversion en retour.

---

## 2. Architecture — les 5 étages

```
┌─────────────────────────────────────────────────────────┐
│  [1] SCANNER          → détecte + score les événements   │
│         ↓ events                                         │
│  [2] LINK BUILDER     → construit l'URL Expedia + subid  │
│         ↓ offers                                         │
│  [3] REDIRECTOR       → genia.ca/go/{hash} → Expedia     │
│         ↓ clicks                                         │
│  [4] PUBLISHER        → queue → workers FB / IG          │
│         ↓ posts                                          │
│  [5] ANALYTICS        → import commissions → scoring     │
│         ↺ réinjecte dans [1]                             │
└─────────────────────────────────────────────────────────┘
```

**Règle d'or :** chaque étage communique uniquement par la base de données. Aucun appel direct entre modules. Tu peux réécrire, arrêter ou remplacer un étage sans toucher aux autres.

---

## 3. Arborescence du dépôt

```
genia-travel-bot/
├── packages/
│   ├── core/                  # types partagés, client DB, logger, config
│   │   ├── src/types.ts
│   │   ├── src/db.ts
│   │   └── src/config.ts
│   ├── scanner/               # ÉTAGE 1
│   │   ├── src/sources/       # 1 fichier par source
│   │   ├── src/dedupe.ts
│   │   └── src/scoring.ts
│   ├── linkbuilder/           # ÉTAGE 2
│   │   ├── src/expedia.ts
│   │   └── src/subid.ts
│   ├── redirector/            # ÉTAGE 3 (service HTTP)
│   │   └── src/server.ts
│   ├── publisher/             # ÉTAGE 4
│   │   ├── src/queue.ts
│   │   ├── src/workers/facebook.ts
│   │   ├── src/workers/instagram.ts
│   │   ├── src/creative/copy.ts
│   │   └── src/creative/image.ts
│   └── analytics/             # ÉTAGE 5
│       ├── src/import.ts
│       └── src/report.ts
├── migrations/
├── docker-compose.yml         # postgres + redis en local
├── .env.example
└── README.md
```

Monorepo avec workspaces npm (ou pnpm). Un seul `npm install` à la racine.

---

## 4. Schéma de base de données

### `events`
| colonne | type | note |
|---|---|---|
| id | uuid PK | |
| dedupe_key | text UNIQUE | `ville_date_slug` — évite les doublons inter-sources |
| title | text | |
| category | text | concert / sport / festival / congres |
| city | text | |
| country | text | |
| venue | text | |
| capacity | int | proxy d'importance |
| starts_at | timestamptz | |
| ends_at | timestamptz | |
| source | text | quel scraper l'a trouvé |
| source_url | text | |
| score | numeric | 0–100, calculé par `scoring.ts` |
| status | text | `new` / `approved` / `rejected` / `published` |
| created_at | timestamptz | |

### `offers`
| colonne | type | note |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK | |
| origin | text | ex. `YUL` |
| destination | text | ex. `NYC` |
| check_in / check_out | date | J-1 / J+1 de l'événement |
| product_type | text | `hotel` / `flight_hotel` |
| target_url | text | URL Expedia complète avec affilié |
| short_hash | text UNIQUE | segment de `genia.ca/go/{hash}` |
| subid | text | `evt{id}-{platform}-{yyyymmdd}` |

### `posts`
| colonne | type | note |
|---|---|---|
| id | uuid PK | |
| offer_id | uuid FK | |
| platform | text | `facebook` / `instagram` |
| status | text | `queued` / `published` / `failed` |
| external_id | text | ID du post retourné par Meta |
| scheduled_at / published_at | timestamptz | |
| error | text | dernière erreur si `failed` |
| attempts | int | |

### `clicks`
| colonne | type |
|---|---|
| id, offer_id, post_id, ip_hash, user_agent, referer, clicked_at |

### `conversions`
| colonne | type | note |
|---|---|---|
| id, subid, booking_value, commission, currency, status, booked_at | jointure sur `offers.subid` |

---

## 5. Contrats entre modules

Ce sont les seules interfaces à respecter. Le reste est libre.

```ts
// ÉTAGE 1 — chaque source exporte ça
interface EventSource {
  name: string;
  fetch(): Promise<RawEvent[]>;
}

// ÉTAGE 2
buildOffer(event: Event, route: Route): Promise<Offer>;

// ÉTAGE 4
enqueuePost(job: PostJob): Promise<string>;
interface PostJob {
  offerId: string;
  platform: 'facebook' | 'instagram';
  copy: string;
  imageUrl: string;
  scheduledAt: Date;
}

// ÉTAGE 5
importConversions(from: Date, to: Date): Promise<number>;
```

---

## 6. Ordre de construction — 6 phases

Chaque phase se termine par un **jalon testable**. Ne passe jamais à la suivante sans valider.

### Phase 0 — Fondations (0,5 j)
Monorepo, `docker-compose` (Postgres + Redis), migrations, config `.env`, logger.
**Jalon :** `npm run dev` démarre et se connecte à la base.

### Phase 1 — Link builder + Redirector (1 j)
*On commence par là : c'est le cœur monétaire et le seul étage impossible à corriger après publication.*
Constructeur d'URL Expedia, génération de subid, service HTTP de redirection avec log des clics.
**Jalon :** tu ouvres `localhost:3000/go/abc123`, tu arrives sur Expedia avec ton ID affilié visible dans l'URL, et une ligne apparaît dans `clicks`.

### Phase 2 — Scanner + scoring (1,5 j)
Une seule source pour commencer (la plus fiable), déduplication, scoring, statut `new`.
**Jalon :** 50 événements réels en base, sans doublons, triés par score. Tu les lis et tu es d'accord avec le classement.

### Phase 3 — Générateur de créa (1 j)
Génération du texte d'annonce (LLM ou templates) + visuel. Mention « Publicité » intégrée dans le gabarit, pas ajoutée à la main.
**Jalon :** 10 créas générées, revues manuellement, aucune n'est embarrassante ou fausse.

### Phase 4 — Publisher (2 j) ← *la phase la plus longue*
App Meta, tokens longue durée, queue BullMQ, workers FB et IG séparés, backoff exponentiel, throttling 3–5 posts/jour/page.
**Jalon :** un post réel publié sur une page de test, visible, cliquable, et le clic remonte dans `clicks`.

### Phase 5 — Analytics + boucle (1 j)
Import du rapport d'affiliation, jointure sur subid, rapport de conversion par catégorie.
**Jalon :** un tableau « catégorie → clics → conversions → revenu » qui a du sens.

### Phase 6 — Automatisation (0,5 j)
Cron : scan quotidien, mise en file, publication étalée. Alertes sur token expiré et sur worker en échec.
**Jalon :** 7 jours sans intervention manuelle.

**Total estimé : 7–8 jours de dev effectif.**

---

## 7. Décisions à figer avant de coder

Réponds à ces 5 questions, elles conditionnent le code :

1. **Villes d'origine** — uniquement YUL/YYZ, ou multi-origine ?
2. **Périmètre géographique** — événements Amérique du Nord seulement, ou monde ?
3. **Validation humaine** — publication 100 % auto, ou file d'approbation avant publication ? *(Recommandation : approbation manuelle les 3 premières semaines.)*
4. **Fenêtre de publication** — je recommande J-21 à J-56 avant l'événement. La fenêtre de réservation voyage est là ; publier à J-3 ne convertit pas.
5. **Sources d'événements** — lesquelles ton agent scanne déjà ?

> Statut : pas encore répondues — voir README.md, section « Décisions ouvertes ». Aucune n'est nécessaire pour la Phase 1 (link builder + redirector) ; elles conditionnent les Phases 2 à 6.

---

## 8. Les 6 pièges qui vont te coûter du temps

| Piège | Parade |
|---|---|
| Tokens Meta qui expirent silencieusement | Refresh auto + alerte à J-7 de l'expiration |
| Doublons inter-sources | `dedupe_key` en contrainte UNIQUE dès la phase 2 |
| Burst de publications → flag Meta | Throttling dur dans le worker, pas dans le cron |
| Lien affilié mal formé = trafic offert | Test automatisé qui vérifie la présence de l'ID dans l'URL finale |
| Redirections en cascade | Un seul hop, domaine propre, jamais de raccourcisseur tiers |
| Événement annulé/déplacé | Re-vérification à J-7, dépublication si annulé |

---

## 9. Variables d'environnement

```
DATABASE_URL=
REDIS_URL=
EXPEDIA_AFFILIATE_ID=
EXPEDIA_NETWORK=          # partnerize | impact
EXPEDIA_POS=CA
REDIRECT_BASE_URL=https://genia.ca/go
META_APP_ID=
META_APP_SECRET=
META_PAGE_ID=
META_PAGE_TOKEN=
IG_BUSINESS_ID=
MAX_POSTS_PER_DAY=4
PUBLISH_WINDOW_MIN_DAYS=21
PUBLISH_WINDOW_MAX_DAYS=56
```
