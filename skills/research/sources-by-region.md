# Sources by region

Read by `maps-lists:research` when the city is in a region below. Each row adds to the general
sources in SKILL.md, never replaces them: local press, Reddit and Telegram still run, and any
credible local source found along the way (a food blogger, a neighbourhood magazine, an Instagram
critic with a track record) counts the same way. Search in the local language as well as English.
A region not listed here uses the general sources only.

- **Japan:** Tabelog first, then Tabelog Hyakumeiten (百名店, the yearly best-of per genre) and
  Retty. Tabelog scores are compressed: 3.5+ is very good, 4.0+ is rare, 3.0–3.4 is ordinary, so
  never read them like Google stars. Reddit and Google ratings are weak signals here. Search in
  Japanese («<area> <category> 食べログ», «百名店 <genre>»).
- **South Korea:** Naver Map reviews and Naver blogs (fetch `m.blog.naver.com/...` when the
  desktop page won't load), Kakao Map ratings, Blue Ribbon Survey (블루리본 서베이). Naver blogs are
  full of sponsored posts: 협찬, 체험단, 원고료, «제공받아» mean paid and don't count as a source.
  Google has few Korean reviews. Search in Korean.
- **Mainland China:** Dianping (大众点评) and its 必吃榜 list, Meituan's Black Pearl (黑珍珠) guide,
  Xiaohongshu (小红书) notes. All sit behind a login: snippets only, no `WebFetch`. Google Maps
  has thin, often outdated data there, so tell the user in one line before researching that
  some places may not be found in Maps. Search in Chinese.
- **Hong Kong / Macau:** OpenRice (widely used by locals, weigh like Reddit comments), SCMP food
  coverage, Michelin and its street-food picks. Search in Chinese too.
- **Thailand:** Wongnai (the local review platform), BK Magazine for Bangkok, Michelin Bib
  Gourmand. Search in Thai.
- **Singapore:** Burpple, Eatbook, Seth Lui, Michelin Bib Gourmand and its hawker picks.
- **France:** Le Fooding, Gault&Millau, city dailies' food pages. Search in French.
  - **Paris bakeries:** the contest results for the current and previous year: the Ville de
    Paris Grand Prix de la meilleure baguette de tradition française («grand prix baguette
    tradition <year> classement»), and the best-croissant contests («meilleur croissant au beurre
    Paris <year>», «concours meilleur croissant Île-de-France <year>»). Their top 3 count as a
    contest podium in step 2.
  - **Paris, every category:** David Lebovitz ([davidlebovitz.com](https://www.davidlebovitz.com/)),
    a pastry chef and food writer living in Paris since 2004: bakeries, pastry, chocolate, cafés,
    bistros, markets. Search `site:davidlebovitz.com <category or place>` and fetch the post.
    A post from the current or previous year counts as one strong local source (a local food
    critic); an older one counts as one source, and the place still needs a current sign that
    it's open and as good.
- **Italy:** Gambero Rosso, Slow Food's *Osterie d'Italia* (strong for trattorie and osterie),
  Dissapore. Search in Italian.
- **Spain:** Guía Repsol (Soles), El Comidista (El País), Michelin. Search in Spanish, and in
  Catalan or Basque where local.
- **Nordics:** White Guide (Sweden, Denmark, Nordic editions). Search in the local language.
- **Turkey:** Culinary Backstreets for Istanbul, Turkish-language food blogs and city media.
  Search in Turkish.
- **United States** (and wherever Eater has a city site): Eater. Claude Code's `WebFetch` can't open
  eater.com (blocked), so use `WebSearch` snippets only: `site:eater.com <city> <category>`. Its
  "best new" and "hottest" lists are where hype and tourist-trap picks show up: count a place only
  when Reddit or local press back it too. Not verified which cities it covers; a search with no
  results for the city means none.
- **Latin America:** Guía Óleo (Argentina; user reviews, weigh like Reddit comments), Veja Comer
  & Beber (Brazil), Chilango and Time Out México (Mexico City), local Instagram critics. Search in
  Spanish or Portuguese.
