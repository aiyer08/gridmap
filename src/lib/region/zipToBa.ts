/**
 * ZIP code → balancing authority.
 *
 * There is no free, authoritative ZIP → BA dataset, because ZIP codes are mail
 * routes and balancing authorities are wires. They genuinely disagree: one ZIP
 * in Phoenix can be half APS and half SRP, and Coachella Valley streets
 * alternate between IID and SCE. So this module is deliberately layered, and
 * every layer reports how confident it is:
 *
 *   1. `ZIP5_BA_OVERRIDES`  — a hand-checked ZIP for a known boundary problem.
 *                             `matchedBy: "zip"`, `approximate: false`.
 *   2. `ZIP3_BA_OVERRIDES`  — the 3-digit prefix lands somewhere with a clearly
 *                             dominant utility. `matchedBy: "zip3"`.
 *   3. `STATE_PRIMARY_BA`   — the state's biggest grid. `matchedBy: "state"`.
 *
 * Layers 2 and 3 are always `approximate: true`. We would rather tell a Fort
 * Collins homeowner "this is the Colorado grid, roughly" than quietly pretend we
 * know which side of a substation their house is on.
 *
 * WHERE THIS IS KNOWN TO BE COARSE
 * - Phoenix (APS vs SRP) is interleaved street by street. ZIP3 gets the broad
 *   split right and individual houses wrong.
 * - Municipal utilities embedded in a bigger BA (Pasadena, Santa Clara, Austin,
 *   Fayetteville NC) are reported as their parent BA, which is correct for
 *   carbon-intensity purposes but may surprise the user.
 * - Rural co-op territory is the weakest case everywhere: a co-op's power can
 *   come from a BA hundreds of miles from its poles.
 * - Colorado, Wyoming, Montana and the Dakotas moved to SPP's new SWPW area on
 *   2026-04-01, so those regions have months rather than years of history.
 *
 * SOURCES
 * - ZIP3 → state (`data/zip3.json`): the dominant state across two independent
 *   public ZIP datasets (scpike/us-state-county-zip, midwire/free_zipcode_data,
 *   ~42k ZIPs combined), with USPS's published prefix-by-state ranges filling
 *   the 83 prefixes neither dataset covers. The two sources disagreed with the
 *   USPS ranges on exactly three prefixes, all of them single-purpose ZIPs where
 *   the data is right and the range is wrong (055 = IRS Andover MA, 201 =
 *   Dulles VA, 733 = IRS Austin TX).
 * - BA assignments: utility service territories cross-checked against the
 *   EIA-930 respondent list (see balancingAuthorities.ts) and the representative
 *   city names in each prefix.
 */

import zip3Data from "./data/zip3.json";
import { BA_METADATA, UNSUPPORTED_AREAS } from "./balancingAuthorities";

/**
 * 995 three-digit prefixes → USPS state/territory code. Covers every prefix in
 * use; 000–004 are excluded because they are not assigned.
 */
export const ZIP3_TO_STATE: Record<string, string> = zip3Data;

/**
 * The grid most of a state's households sit on. Used when no prefix override
 * applies, which is most of the country — 30 states have a single dominant BA.
 *
 * Where a state is genuinely split, this is the *most populous* option, not the
 * geographically largest: Illinois is PJM because Chicago is, even though most
 * of the state's area is MISO.
 */
export const STATE_PRIMARY_BA: Record<string, string> = {
  AL: "SOCO",
  AR: "MISO",
  AZ: "AZPS",
  CA: "CISO",
  CO: "PSCO",
  CT: "ISNE",
  DC: "PJM",
  DE: "PJM",
  FL: "FPL",
  GA: "SOCO",
  IA: "MISO",
  ID: "IPCO",
  IL: "PJM",
  IN: "MISO",
  KS: "SWPP",
  KY: "LGEE",
  LA: "MISO",
  MA: "ISNE",
  MD: "PJM",
  ME: "ISNE",
  MI: "MISO",
  MN: "MISO",
  MO: "MISO",
  MS: "MISO",
  MT: "NWMT",
  NC: "DUK",
  ND: "SWPP",
  NE: "SWPP",
  NH: "ISNE",
  NJ: "PJM",
  NM: "PNM",
  NV: "NEVP",
  NY: "NYIS",
  OH: "PJM",
  OK: "SWPP",
  OR: "PACW",
  PA: "PJM",
  RI: "ISNE",
  SC: "SCEG",
  SD: "SWPP",
  TN: "TVA",
  TX: "ERCO",
  UT: "PACE",
  VA: "PJM",
  VT: "ISNE",
  WA: "BPAT",
  WI: "MISO",
  WV: "PJM",
  WY: "PACE",
  // AK and HI deliberately absent: see UNSUPPORTED_AREAS.
};

/**
 * Three-digit prefixes whose dominant utility differs from the state default.
 * Grouped by state so the reasoning stays readable; the comment on each block
 * names the utility, because "805 → SWPW" is meaningless six months from now.
 */
export const ZIP3_BA_OVERRIDES: Record<string, string> = {
  // ---- California: CAISO is the default, but four islands aren't in it. ----
  // City of Los Angeles, plus Burbank and Glendale, are the LADWP balancing area.
  "900": "LDWP", // Los Angeles
  "901": "LDWP", // Los Angeles (PO boxes)
  "912": "LDWP", // Glendale, La Crescenta
  "913": "LDWP", // Northridge, Chatsworth, Woodland Hills
  "914": "LDWP", // Van Nuys, Encino, Sherman Oaks
  "915": "LDWP", // Burbank
  "916": "LDWP", // North Hollywood, Studio City
  // Imperial Irrigation District: Imperial County and the eastern Coachella
  // Valley. Palm Springs and Palm Desert are SCE — see ZIP5_BA_OVERRIDES.
  "922": "IID", // El Centro, Calexico, Indio, Coachella
  // Balancing Authority of Northern California: SMUD, Roseville, Modesto,
  // Redding, Shasta Lake.
  "942": "BANC", // Sacramento (state government PO boxes)
  "956": "BANC", // Roseville, Citrus Heights, Folsom, Carmichael
  "957": "BANC", // Rancho Cordova, Elk Grove
  "958": "BANC", // Sacramento
  "960": "BANC", // Redding, Anderson, Shasta Lake

  // ---- Washington: BPA is the default; the big metros aren't on it. ----
  "980": "PSEI", // Bellevue, Renton, Kent (Puget Sound Energy)
  "981": "SCL", //  Seattle (Seattle City Light)
  "982": "BPAT", // Everett, Marysville (Snohomish County PUD, a BPA customer)
  "983": "PSEI", // Bremerton, Puyallup, Gig Harbor
  "984": "TPWR", // Tacoma (Tacoma Power)
  "985": "PSEI", // Olympia, Lacey
  "986": "BPAT", // Vancouver WA (Clark Public Utilities)
  "988": "CHPD", // Wenatchee (Chelan County PUD)
  "989": "PACW", // Yakima, Ellensburg (Pacific Power)
  "990": "AVA", //  Cheney, Colbert (Avista)
  "991": "AVA", //  Pullman, Colville (Avista)
  "992": "AVA", //  Spokane (Avista)
  "993": "BPAT", // Kennewick, Pasco, Richland (Benton/Franklin PUDs)
  "994": "AVA", //  Clarkston (Avista)

  // ---- Oregon: Pacific Power is the default. ----
  "970": "PGE", //  Beaverton, Gresham (Portland General Electric)
  "971": "PGE", //  Hillsboro
  "972": "PGE", //  Portland
  "973": "PGE", //  Salem
  "974": "BPAT", // Eugene, Springfield (municipal utilities on BPA)
  "979": "IPCO", // Ontario / Malheur County (Idaho Power)

  // ---- Arizona: APS is the default; SRP owns the east valley. ----
  "851": "SRP", //  Apache Junction, Queen Creek
  "852": "SRP", //  Mesa, Scottsdale, Tempe, Chandler
  "856": "TEPC", // Sierra Vista, Nogales, Douglas (UNS Electric / TEP)
  "857": "TEPC", // Tucson
  "864": "WALC", // Kingman, Bullhead City, Lake Havasu City
  "865": "WALC", // Navajo Nation (Chinle, Ganado, Tuba City)

  // ---- New Mexico: PNM is the default. ----
  "879": "EPE", //  Hatch, Caballo (El Paso Electric)
  "880": "EPE", //  Las Cruces, Deming
  "881": "SWPP", // Clovis, Portales (Xcel / SPS)
  "882": "SWPP", // Hobbs, Roswell, Carlsbad, Artesia (Xcel / SPS)
  "883": "EPE", //  Alamogordo, Ruidoso
  "884": "SWPP", // Tucumcari (Xcel / SPS)

  // ---- Texas: ERCOT covers ~90% of load but not these. ----
  "755": "SWPP", // Texarkana, Atlanta (SWEPCO — Eastern Interconnection)
  "756": "SWPP", // Longview, Marshall (SWEPCO)
  "776": "MISO", // Orange, Port Arthur (Entergy Texas)
  "777": "MISO", // Beaumont (Entergy Texas)
  "790": "SWPP", // Amarillo area, Plainview (Xcel / SPS)
  "791": "SWPP", // Amarillo
  "792": "SWPP", // Childress
  "793": "SWPP", // Levelland, Littlefield (Xcel / SPS)
  "798": "EPE", //  Canutillo, Clint, Fabens (El Paso Electric)
  "799": "EPE", //  El Paso
  "885": "EPE", //  El Paso (PO boxes)

  // ---- Colorado: Xcel (PSCO) is the default. Everything else moved to SPP
  // West on 2026-04-01, apart from Black Hills in Pueblo. ----
  "805": "SWPW", // Fort Collins, Loveland, Longmont (Platte River Power Authority)
  "807": "SWPW", // Eastern plains co-ops (Tri-State)
  "808": "SWPW", // Limon, eastern plains
  "809": "SWPW", // Colorado Springs (Colorado Springs Utilities)
  "810": "BHBA", // Pueblo, Cañon City (Black Hills Energy)
  "811": "SWPW", // Alamosa, San Luis Valley
  "812": "SWPW", // Gunnison, Salida
  "813": "SWPW", // Durango, Cortez (La Plata Electric)
  "814": "SWPW", // Montrose, Delta
  "816": "SWPW", // Craig, Aspen, Vail (Holy Cross, Yampa Valley)

  // ---- Wyoming: Rocky Mountain Power (PACE) is the default. ----
  "820": "BHBA", // Cheyenne (Black Hills Energy)
  "822": "SWPW", // Wheatland (Basin Electric co-ops)
  "824": "SWPW", // Worland, Basin (Big Horn REC)
  "827": "BHBA", // Gillette, Newcastle (Black Hills Power)
  "828": "SWPW", // Sheridan, Buffalo (Montana-Dakota Utilities)
  "830": "BPAT", // Jackson, Wilson (Lower Valley Energy, a BPA customer)

  // ---- Montana: NorthWestern Energy is the default. ----
  "590": "SWPW", // Ashland, Roundup (Basin Electric co-ops)
  "592": "SWPW", // Northeast Montana co-ops
  "593": "SWPW", // Baker, Ekalaka (Montana-Dakota Utilities)
  "595": "SWPW", // Havre, Chester (Hill County Electric)
  "599": "BPAT", // Kalispell (Flathead Electric, a BPA customer)

  // ---- Idaho: Idaho Power is the default. ----
  "834": "BPAT", // Idaho Falls, Rexburg (municipal utilities on BPA)
  "835": "AVA", //  Lewiston, Orofino (Avista)
  "838": "AVA", //  Coeur d'Alene, Moscow, Sandpoint (Avista)

  // ---- North Dakota: eastern half is MISO, western half moved to SPP West. ----
  "580": "MISO", // Wahpeton (Otter Tail Power)
  "581": "MISO", // Fargo (Xcel)
  "582": "MISO", // Grand Forks (Xcel)
  "583": "MISO", // Devils Lake, Belcourt (Otter Tail)
  "584": "MISO", // Jamestown (Otter Tail)
  "585": "SWPW", // Bismarck (Montana-Dakota Utilities)
  "586": "SWPW", // Bowman, Beach
  "587": "SWPW", // Minot (Verendrye, Basin Electric)
  "588": "SWPW", // Williston (Montana-Dakota Utilities)
  "589": "SWPW", // Western North Dakota

  // ---- South Dakota: SPP is the default. ----
  "570": "MISO", // Brookings, Yankton (Otter Tail, Xcel)
  "571": "MISO", // Sioux Falls (Xcel)
  "572": "MISO", // Watertown, Milbank (Otter Tail)
  "576": "SWPW", // Mobridge (Grand Electric, Basin)
  "577": "BHBA", // Rapid City, Spearfish (Black Hills Power)

  // ---- Missouri: Ameren (MISO) east, Evergy (SPP) west. ----
  "640": "SWPP", // Independence, Lee's Summit
  "641": "SWPP", // Kansas City
  "642": "SWPP", // Kansas City (PO boxes)
  "643": "SWPP", // Kansas City (PO boxes)
  "644": "SWPP", // Northwest Missouri
  "645": "SWPP", // St. Joseph
  "646": "SWPP", // Chillicothe
  "647": "SWPP", // Harrisonville
  "648": "SWPP", // Joplin (Empire District)
  "649": "SWPP", // Kansas City (PO boxes)
  "653": "SWPP", // Sedalia
  "656": "SWPP", // Branson, Hollister
  "657": "SWPP", // Southwest Missouri
  "658": "SWPP", // Springfield (City Utilities)
  "659": "SWPP", // Southwest Missouri

  // ---- Kentucky: LG&E/KU is the default. ----
  "407": "PJM", //  London, Corbin (East Kentucky Power Cooperative)
  "408": "PJM", //  Harlan, Benham
  "409": "PJM", //  Middlesboro, Pineville
  "410": "PJM", //  Covington, Newport (Duke Energy Kentucky)
  "411": "PJM", //  Ashland (Kentucky Power / AEP)
  "412": "PJM", //  Paintsville, Prestonsburg
  "413": "PJM", //  Jackson, Booneville
  "414": "PJM", //  West Liberty
  "415": "PJM", //  Pikeville
  "416": "PJM", //  Floyd County
  "417": "PJM", //  Hazard
  "418": "PJM", //  Whitesburg
  "420": "TVA", //  Paducah (West Kentucky RECC)
  "421": "TVA", //  Bowling Green, Glasgow
  "422": "TVA", //  Hopkinsville (Pennyrile RECC)
  "423": "MISO", // Owensboro (Big Rivers Electric)
  "424": "MISO", // Henderson (Big Rivers Electric)
  "425": "PJM", //  Somerset (South Kentucky RECC)
  "426": "PJM", //  Albany, Jamestown

  // ---- Illinois: ComEd (PJM) north, Ameren (MISO) centre and south. ----
  "612": "MISO", // Moline, Rock Island (MidAmerican)
  "614": "MISO", // Galesburg
  "615": "MISO", // Pekin
  "616": "MISO", // Peoria
  "617": "MISO", // Bloomington, Normal
  "618": "MISO", // Champaign, Urbana, Danville
  "619": "MISO", // Arcola, Arthur
  "620": "MISO", // Edwardsville, Alton
  "621": "MISO", // Metro East
  "622": "MISO", // Belleville, East St. Louis
  "623": "MISO", // Quincy
  "624": "MISO", // Effingham
  "625": "MISO", // Decatur
  "626": "MISO", // Jacksonville
  "627": "MISO", // Springfield
  "628": "MISO", // Centralia
  "629": "MISO", // Carbondale

  // ---- Indiana: MISO is the default; AEP's I&M territory is PJM. ----
  "465": "PJM", //  Elkhart, Mishawaka
  "466": "PJM", //  South Bend
  "467": "PJM", //  Angola, Albion
  "468": "PJM", //  Fort Wayne
  "473": "PJM", //  Muncie, Richmond

  // ---- Louisiana: Entergy/Cleco (MISO) except SWEPCO in the northwest. ----
  "710": "SWPP", // Minden, Arcadia
  "711": "SWPP", // Shreveport, Bossier City

  // ---- Arkansas: Entergy (MISO) except the southwest and northwest. ----
  "717": "SWPP", // Magnolia, Camden (SWEPCO)
  "718": "SWPP", // Texarkana AR, Ashdown
  "726": "SWPP", // Harrison
  "727": "SWPP", // Fayetteville, Springdale, Rogers, Bentonville (SWEPCO)
  "729": "SWPP", // Fort Smith (OG&E)

  // ---- Mississippi: Entergy (MISO) except TVA north and Southern south. ----
  "386": "TVA", //  Southaven, DeSoto County
  "388": "TVA", //  Tupelo, Amory
  "393": "SOCO", // Meridian (Mississippi Power)
  "394": "SOCO", // Hattiesburg, Laurel
  "395": "SOCO", // Gulfport, Biloxi, Pascagoula
  "397": "TVA", //  Columbus, Starkville (4-County Electric)

  // ---- Alabama: Alabama Power (SOCO) except the TVA north. ----
  "356": "TVA", //  Decatur, Florence, Athens
  "357": "TVA", //  Madison, Scottsboro
  "358": "TVA", //  Huntsville
  "359": "TVA", //  Albertville, Boaz, Arab

  // ---- North Carolina: three Dukes plus a Dominion corner. ----
  "275": "CPLE", // Cary, Goldsboro
  "276": "CPLE", // Raleigh
  "278": "CPLE", // Greenville, Wilson, Rocky Mount
  "279": "PJM", //  Elizabeth City, Outer Banks (Dominion Energy NC)
  "283": "CPLE", // Fayetteville, Lumberton
  "284": "CPLE", // Wilmington
  "285": "CPLE", // Kinston, Jacksonville, New Bern
  "287": "CPLW", // Hendersonville, Waynesville
  "288": "CPLW", // Asheville
  "289": "CPLW", // Murphy, Andrews

  // ---- South Carolina: Dominion SC is the default. ----
  "293": "DUK", //  Spartanburg, Gaffney
  "295": "SC", //   Myrtle Beach, Conway (Santee Cooper / Horry Electric)
  "296": "DUK", //  Greenville, Anderson
  "297": "DUK", //  Rock Hill, Fort Mill

  // ---- Florida: FPL is the default, but Florida is a patchwork of nine BAs. ----
  "322": "JEA", //  Jacksonville
  "323": "TAL", //  Tallahassee
  "326": "GVL", //  Gainesville
  "327": "FPC", //  Deltona, DeLand (Duke Energy Florida)
  "328": "FMPP", // Orlando (Orlando Utilities Commission)
  "335": "TEC", //  Brandon, Lutz (Tampa Electric)
  "336": "TEC", //  Tampa
  "337": "FPC", //  St. Petersburg, Clearwater (Duke Energy Florida)
  "338": "FMPP", // Lakeland (Lakeland Electric)
  "344": "FPC", //  Ocala, Inverness
  "346": "FPC", //  Brooksville, Spring Hill
  "347": "FMPP", // Kissimmee (Kissimmee Utility Authority)
};

/**
 * Individual ZIPs where the 3-digit prefix straddles two very different grids
 * and enough people live there to be worth the maintenance.
 *
 * Prefix 922 defaults to IID (gas-heavy) because Imperial County plus eastern
 * Coachella outnumbers the SCE side; these are the SCE (CAISO) exceptions.
 * Prefix 953 defaults to CAISO; these are the Modesto (BANC) and Turlock (TIDC)
 * irrigation districts.
 */
export const ZIP5_BA_OVERRIDES: Record<string, string> = {
  // Western Coachella Valley and the high desert: Southern California Edison.
  "92210": "CISO", // Indian Wells
  "92211": "CISO", // Palm Desert
  "92225": "CISO", // Blythe
  "92234": "CISO", // Cathedral City
  "92235": "CISO", // Cathedral City
  "92239": "CISO", // Desert Center
  "92240": "CISO", // Desert Hot Springs
  "92241": "CISO", // Desert Hot Springs
  "92252": "CISO", // Joshua Tree
  "92256": "CISO", // Morongo Valley
  "92258": "CISO", // North Palm Springs
  "92260": "CISO", // Palm Desert
  "92261": "CISO", // Palm Desert
  "92262": "CISO", // Palm Springs
  "92263": "CISO", // Palm Springs
  "92264": "CISO", // Palm Springs
  "92268": "CISO", // Pioneertown
  "92270": "CISO", // Rancho Mirage
  "92276": "CISO", // Thousand Palms
  "92277": "CISO", // Twentynine Palms
  "92278": "CISO", // Twentynine Palms
  "92282": "CISO", // Whitewater
  "92284": "CISO", // Yucca Valley
  "92285": "CISO", // Landers
  "92286": "CISO", // Yucca Valley

  // Modesto Irrigation District, a member of BANC.
  "95350": "BANC",
  "95351": "BANC",
  "95352": "BANC",
  "95353": "BANC",
  "95354": "BANC",
  "95355": "BANC",
  "95356": "BANC",
  "95357": "BANC",
  "95358": "BANC",
  "95367": "BANC", // Riverbank
  "95368": "BANC", // Salida
  "95386": "BANC", // Waterford

  // Turlock Irrigation District, its own balancing authority.
  "95307": "TIDC", // Ceres
  "95312": "TIDC", // Delhi
  "95316": "TIDC", // Denair
  "95323": "TIDC", // Hickman
  "95324": "TIDC", // Hilmar
  "95326": "TIDC", // Hughson
  "95328": "TIDC", // Keyes
  "95380": "TIDC", // Turlock
  "95381": "TIDC", // Turlock
  "95382": "TIDC", // Turlock
};

/**
 * The clock a household in this state reads. Deliberately separate from a BA's
 * timezone: BPA spans Pacific and Mountain, and the user cares about their own
 * kitchen clock, not Bonneville's.
 */
export const STATE_TIMEZONES: Record<string, string> = {
  AK: "America/Anchorage",
  AL: "America/Chicago",
  AR: "America/Chicago",
  AZ: "America/Phoenix",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DC: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  IA: "America/Chicago",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  MA: "America/New_York",
  MD: "America/New_York",
  ME: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MO: "America/Chicago",
  MS: "America/Chicago",
  MT: "America/Denver",
  NC: "America/New_York",
  ND: "America/Chicago",
  NE: "America/Chicago",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NV: "America/Los_Angeles",
  NY: "America/New_York",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VA: "America/New_York",
  VT: "America/New_York",
  WA: "America/Los_Angeles",
  WI: "America/Chicago",
  WV: "America/New_York",
  WY: "America/Denver",
  // Territories, so the UI can at least render a clock.
  AA: "America/New_York",
  AE: "Europe/London",
  AP: "Pacific/Honolulu",
  GU: "Pacific/Guam",
  PR: "America/Puerto_Rico",
  VI: "America/St_Thomas",
};

/** Prefixes that sit in a different timezone from the rest of their state. */
export const ZIP3_TIMEZONE_OVERRIDES: Record<string, string> = {
  // Florida panhandle west of the Apalachicola River is Central.
  "324": "America/Chicago", // Panama City, Marianna
  "325": "America/Chicago", // Pensacola, Crestview
  // Northwest and southwest Indiana are Central.
  "463": "America/Chicago", // Hammond, Gary
  "464": "America/Chicago", // Gary, Merrillville
  "476": "America/Chicago", // Newburgh, Boonville
  "477": "America/Chicago", // Evansville
  // Western Kentucky is Central.
  "420": "America/Chicago", // Paducah
  "421": "America/Chicago", // Bowling Green
  "422": "America/Chicago", // Hopkinsville
  "423": "America/Chicago", // Owensboro
  "424": "America/Chicago", // Henderson
  // East Tennessee is Eastern.
  "373": "America/New_York", // Cleveland, Athens
  "374": "America/New_York", // Chattanooga
  "376": "America/New_York", // Kingsport, Johnson City
  "377": "America/New_York", // Greeneville, Clinton
  "378": "America/New_York", // Maryville, Morristown
  "379": "America/New_York", // Knoxville
  // The western Upper Peninsula is Central.
  "498": "America/Menominee", // Iron Mountain
  "499": "America/Menominee", // Ironwood, Houghton
  // Far western Kansas is Mountain.
  "677": "America/Denver", // Colby, Goodland
  "679": "America/Denver", // Liberal, Hugoton
  // The Nebraska panhandle is Mountain.
  "691": "America/Denver", // Sidney
  "693": "America/Denver", // Scottsbluff, Alliance
  // Southwest North Dakota and the Black Hills are Mountain.
  "586": "America/Denver", // Bowman, Beach
  "576": "America/Denver", // Mobridge
  "577": "America/Denver", // Rapid City
  // Far west Texas is Mountain.
  "798": "America/Denver", // Canutillo, Clint
  "799": "America/Denver", // El Paso
  "885": "America/Denver", // El Paso
  // Malheur County, Oregon runs on Boise time.
  "979": "America/Boise", // Ontario, Adrian
  // The Idaho panhandle north of the Salmon River is Pacific.
  "835": "America/Los_Angeles", // Lewiston, Orofino
  "838": "America/Los_Angeles", // Coeur d'Alene, Moscow, Sandpoint
};

export type ZipMatchTier = "zip" | "zip3" | "state";

export interface ZipBaMatch {
  ba: string;
  state: string;
  /** Which layer produced the answer. */
  matchedBy: ZipMatchTier;
  timezone: string;
}

/**
 * Normalises whatever we were handed into five digits, or null.
 *
 * Two conveniences, both deliberate:
 * - ZIP+4 ("94305-1234", "94305 1234") keeps only the five-digit route.
 * - Short all-digit input is left-padded, because a ZIP that has been through
 *   `JSON.parse`, a spreadsheet or a number-typed column loses its leading
 *   zeros, and "2108" can only ever have meant "02108".
 *
 * The padding does mean a user who types four digits gets an answer for a
 * different ZIP, so the input UI is responsible for not asking us until it has
 * five characters. Better that than silently failing on every ZIP in New England.
 */
export function normaliseZip(input: string): string | null {
  const head = input.trim().replace(/[\s-].*$/, "");
  if (!/^\d{1,5}$/.test(head)) return null;
  return head.padStart(5, "0");
}

/** USPS state/territory code for a ZIP, from its 3-digit prefix. */
export function stateForZip(zip: string): string | undefined {
  return ZIP3_TO_STATE[zip.slice(0, 3)];
}

/** The clock a household at this ZIP reads. */
export function timezoneForZip(zip: string, state: string): string {
  return (
    ZIP3_TIMEZONE_OVERRIDES[zip.slice(0, 3)] ??
    STATE_TIMEZONES[state] ??
    "America/New_York"
  );
}

/**
 * Resolve a five-digit ZIP to a balancing authority.
 *
 * Returns undefined only when the prefix is unassigned or belongs to an area
 * with no EIA-930 balancing authority (Hawaii, Alaska, the territories,
 * military mail). Callers must handle that rather than guessing.
 */
export function matchZipToBa(zip: string): ZipBaMatch | undefined {
  const state = stateForZip(zip);
  if (!state) return undefined;
  if (state in UNSUPPORTED_AREAS) return undefined;

  const timezone = timezoneForZip(zip, state);

  const exact = ZIP5_BA_OVERRIDES[zip];
  if (exact) return { ba: exact, state, matchedBy: "zip", timezone };

  const prefix = ZIP3_BA_OVERRIDES[zip.slice(0, 3)];
  if (prefix) return { ba: prefix, state, matchedBy: "zip3", timezone };

  const fallback = STATE_PRIMARY_BA[state];
  if (!fallback) return undefined;
  return { ba: fallback, state, matchedBy: "state", timezone };
}

/**
 * Every BA code referenced by the tables above. Exported so a test can assert
 * we never point at a code the EIA has never heard of.
 */
export function referencedBaCodes(): string[] {
  return [
    ...new Set([
      ...Object.values(STATE_PRIMARY_BA),
      ...Object.values(ZIP3_BA_OVERRIDES),
      ...Object.values(ZIP5_BA_OVERRIDES),
    ]),
  ].sort();
}

/** True when `ba` exists in the balancing-authority table. */
export function isKnownBa(ba: string): boolean {
  return ba in BA_METADATA;
}
