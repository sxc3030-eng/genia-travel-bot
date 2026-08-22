# genia-travel-bot

Automatisation : événements majeurs → lien de voyage Expedia affilié et traçable → publication Facebook / Instagram, avec mesure de conversion en retour.

Plan de projet complet : [`docs/PLAN.md`](docs/PLAN.md).

## État d'avancement

- ✅ **Phase 0 — Fondations** : monorepo npm workspaces, `docker-compose` (Postgres + Redis), migrations, config, logger.
- ✅ **Phase 1 — Link builder + Redirector** : constructeur d'URL Expedia affiliée, subid, service de redirection `/go/{hash}` avec log des clics.
- 🟡 **Phase 2 — Scanner + scoring** : source Ticketmaster, filtre géo, déduplication, scoring 0–100, insertion en `new`. Code complet et testé hors-ligne ; **jalon non validé** — il exige une clé API Ticketmaster (voir ci-dessous).
- ✅ **Phase 3 — Générateur de créa** : texte d'annonce + visuel PNG, mention « Publicité » intégrée au gabarit.
- 🟡 **Phase 4 — Publisher** : queue BullMQ (une file par plateforme), workers FB/IG séparés, backoff exponentiel, throttling dur, garde d'approbation, surveillance des tokens. Pipeline vérifié de bout en bout avec l'API Meta bouchonnée ; **jalon non validé** — il exige une app Meta et des tokens réels.
- 🟡 **Phase 5 — Analytics + boucle** : import CSV du rapport d'affiliation (idempotent), jointure sur subid, rapport clics → conversions → revenu par catégorie / origine / ville. Vérifié en base ; **jalon non validé** — il exige un vrai rapport d'affiliation.
- ⬜ Phase 6 — Automatisation

## Démarrage local

```bash
cp .env.example .env        # renseigner au minimum EXPEDIA_AFFILIATE_ID
docker compose up -d        # Postgres + Redis
npm install
npm run migrate             # applique migrations/*.sql
npm run dev                 # démarre le redirector, se connecte à la base
```

`npm run dev` doit logger `connected to database` puis `redirector listening` — c'est le jalon de la Phase 0.

### Vérifier le jalon de la Phase 1

```bash
npm run seed:test-offer
```

Le script insère un événement de test et construit **une offre par ville d'origine** via `buildOffersForEvent()` — soit deux offres (YUL et YYZ), chacune avec son propre `short_hash` et son propre `subid`. Il logue les URL à ouvrir, du type `http://localhost:3000/go/<hash>`. Ouvre-les : tu dois atterrir sur une URL Expedia contenant `EXPEDIA_AFFILIATE_ID` et le subid, et une ligne doit apparaître dans la table `clicks` pour chacune.

```bash
psql "$DATABASE_URL" -c "select offer_id, ip_hash, clicked_at from clicks order by clicked_at desc limit 1;"
```

### Phase 2 — Scanner (jalon en attente d'une clé API)

```bash
# 1. clé gratuite sur https://developer.ticketmaster.com/
echo 'TICKETMASTER_API_KEY=ta_cle' >> .env
npm run scan
```

`npm run scan` fait : `fetch` Ticketmaster → filtre `GEO_SCOPE` (CA/US/MX) → déduplication → scoring → insertion en `status='new'`, puis affiche le top 20 par score. Le jalon du plan (« 50 événements réels en base, sans doublons, triés par score ») se valide en lisant ce classement.

Le scoring est sur 100, décomposé en quatre signaux auditables (`packages/scanner/src/scoring.ts`) :

| Signal | Poids | Logique |
|---|---|---|
| Catégorie | 0–30 | festival > sport > concert > congrès |
| Capacité | 0–25 | log-échelle ; 12 par défaut si inconnue (Ticketmaster ne la fournit pas) |
| Délai | 0–25 | maximum dans la fenêtre J-21..J-56, décroît des deux côtés |
| Destination | 0–20 | **0 si l'événement est dans une ville d'origine** (YUL/YYZ) — personne n'y réserve d'hôtel |

### Phase 3 — Créas

```bash
npm run creative:preview        # écrit packages/publisher/creative-preview/index.html
```

Génère 10 créas (visuel PNG + texte) et une planche-contact HTML pour la revue manuelle du jalon. Utilise les offres réelles en base dès qu'il y en a assez, sinon des fixtures.

**Choix : gabarits, pas de LLM.** Le jalon exige qu'aucune créa ne soit « embarrassante ou fausse ». Un gabarit n'interpole que des champs vérifiés en base (titre, ville, dates) et ne peut donc rien inventer — pas de prix, pas de rabais, pas de disponibilité. Un LLM pourrait halluciner exactement ces faits-là. L'interface reste ouverte si tu veux brancher un générateur LLM plus tard.

Deux règles encodées dans le générateur :

- **La mention « Publicité » est produite par le gabarit**, jamais ajoutée à la main — dans le texte *et* dans le visuel. Des tests vérifient sa présence sur les 2 plateformes × 2 langues.
- **Instagram ne rend pas les liens cliquables dans les légendes.** Le texte IG ne contient donc aucune URL (ce serait du bruit mort) et renvoie vers le lien en bio ; l'URL est retournée à part pour la bio/story.

La langue suit la **ville de départ** : YUL → français, YYZ → anglais.

### Phase 4 — Publisher (jalon en attente des tokens Meta)

```bash
npm run verify:pipeline    # bout en bout avec l'API Meta bouchonnée (Postgres + Redis réels)
npm run workers            # démarre les workers FB + IG (nécessite les vrais tokens)
npm run tokens:check       # sort en code 1 si le token est mort ou expire dans ≤ 7 jours
```

**Ce qui bloque le jalon :** une app Meta, une page de test, un compte Instagram Business, et `META_PAGE_TOKEN` / `IG_BUSINESS_ID` dans `.env`. Le chemin d'appel réel vers Graph API n'est pas testé.

Quatre décisions structurantes :

| Sujet | Choix | Pourquoi |
|---|---|---|
| Files | **Une file par plateforme** (`posts-facebook`, `posts-instagram`) | Un worker BullMQ consomme *tous* les jobs de sa file, sans filtrer par nom. Deux workers sur une file partagée se volent les jobs et en perdent silencieusement. |
| Throttling | **Dans le worker**, compté en base | Piège #3 du plan. Un cron qui espace les jobs ne protège pas d'un rattrapage de backlog ou d'un retry en rafale. |
| Erreurs Meta | Classées en `transient` / `rate_limited` / `auth` / `permanent` | Un token expiré (code 190) échoue immédiatement au lieu de brûler 5 tentatives ; un throttle (code 4) attend 15 min au lieu d'échouer. |
| Image Instagram | Servie par le redirecteur sur `/img/{plateforme}/{hash}.png` | L'API Instagram **va chercher** l'image elle-même : impossible d'envoyer des octets. Elle doit être à une URL publique. Elle est régénérée à la volée depuis la base, donc rien à stocker. |

La garde d'approbation (décision #3) et la fenêtre J-21..J-56 (décision #4) sont appliquées **avant** la mise en file : un événement non approuvé ne devient jamais un job.

### Phase 5 — Analytics (jalon en attente d'un vrai rapport)

```bash
npm run analytics:import -- rapport.csv [partnerize|impact]
npm run analytics:report              # ou: report origin / report city
npm run analytics:verify              # vérification bout en bout en base
```

Le rapport produit le tableau du jalon : **axe → clics → conversions → revenu**, avec le taux de conversion et le revenu par clic.

Quatre règles qui évitent des chiffres faux :

| Règle | Pourquoi |
|---|---|
| **Seuls `approved` et `paid` comptent comme revenu** | `pending` peut encore être rejeté, `rejected` est de l'argent qui n'a jamais existé. Les inclure promet un revenu qui n'arrivera jamais. Ils sont affichés à part. |
| **Jamais d'addition entre devises** | 80 CAD + 20 USD ≠ 100. Le revenu est ventilé par devise, et `rev/clic` reste vide quand il y en a plusieurs. |
| **Upsert sur (réseau, id externe)** | Les rapports d'affiliation se réimportent constamment. Sans clé stable, chaque réimport dupliquait les conversions et gonflait le revenu. |
| **Clics et conversions agrégés séparément** | Les joindre d'un coup les multiplie entre eux : 3 clics et 2 conversions sur la même offre deviendraient 6 de chaque. |

Un statut inconnu, un montant illisible ou un subid absent font **ignorer la ligne** (et le compte est rapporté) plutôt que de deviner.

**La boucle de rétroaction (`loop.ts`) n'est pas branchée sur le scoring**, volontairement. Avec zéro conversion en base, toutes les catégories mesurent zéro revenu par clic : un multiplicateur naïf écraserait tous les scores et classerait sur du bruit. Il faut un vrai rapport d'abord — `MIN_CLICKS_FOR_SIGNAL` (200 clics) est le garde-fou qui décide quand une catégorie a le droit à un avis.

### Tests

```bash
npm run test --workspaces
```

123 tests, dont : l'ID affilié et le subid présents dans l'URL finale (piège #4), et la déduplication résistante aux variantes de titre (piège #2).

## Décisions (plan, section 7)

Les 5 décisions sont figées et reflétées dans `.env.example` / `packages/core/src/config.ts` :

1. **Villes d'origine** — YUL + YYZ (Montréal + Toronto). → `ORIGIN_AIRPORTS`. Un événement approuvé produit **une offre par origine**, chacune avec son subid, pour que les conversions restent attribuables à la ville de départ.
2. **Périmètre géographique** — Amérique du Nord seulement pour le MVP. → `GEO_SCOPE`
3. **Validation humaine** — approbation manuelle activée (recommandation du plan pour les 3 premières semaines). → `HUMAN_APPROVAL_REQUIRED`
4. **Fenêtre de publication** — J-21 à J-56 avant l'événement (recommandation du plan). → `PUBLISH_WINDOW_MIN_DAYS` / `MAX_DAYS`
5. **Sources d'événements** — Ticketmaster Discovery API comme source unique de départ pour la Phase 2. → `EVENT_SOURCE_PRIMARY`, `TICKETMASTER_API_KEY` (clé à obtenir avant d'attaquer la Phase 2)

Détail et justification de chaque choix : [`docs/PLAN.md`](docs/PLAN.md), section 7.

## Variables d'environnement

Voir [`.env.example`](.env.example). `EXPEDIA_AFFILIATE_ID` et `DATABASE_URL` sont requis au démarrage (`packages/core/src/config.ts` lève une erreur explicite s'ils manquent).

## Architecture

Cinq étages, communiquant uniquement via la base de données (aucun appel direct entre modules) :

```
[1] SCANNER → events → [2] LINK BUILDER → offers → [3] REDIRECTOR → clicks
                                                          ↓
[5] ANALYTICS ← conversions ← [4] PUBLISHER ← posts ← [3]
     ↺ réinjecte dans [1]
```

Détails complets dans [`docs/PLAN.md`](docs/PLAN.md).
