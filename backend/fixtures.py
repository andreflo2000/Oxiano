"""
Fixture fetcher — football-data.org API
Descarca meciurile zilei, normalizeaza numele echipelor,
returneaza o lista gata de predictat.
"""

import os
import requests
import datetime
import logging
from difflib import get_close_matches
from typing import Optional
from zoneinfo import ZoneInfo

from circuit_breaker import cb

logger = logging.getLogger(__name__)

BUCHAREST_TZ = ZoneInfo("Europe/Bucharest")

API_KEY          = os.getenv("FOOTBALL_DATA_KEY", "")       # football-data.org (rezultate)
AF_KEY           = os.getenv("API_FOOTBALL_KEY", "")        # api-football.com (fixtures)
ODDS_API_KEY     = os.getenv("ODDS_API_KEY", "")
BASE_URL         = "https://api.football-data.org/v4"
AF_BASE_URL      = "https://v3.football.api-sports.io"
ODDS_API_URL     = "https://api.the-odds-api.com/v4"

# api-football.com league IDs → competition codes
AF_LEAGUE_MAP = {
    39:  "PL",   # Premier League
    78:  "BL1",  # Bundesliga
    135: "SA",   # Serie A
    140: "PD",   # La Liga
    61:  "FL1",  # Ligue 1
    94:  "PPL",  # Primeira Liga
    88:  "DED",  # Eredivisie
    2:   "CL",   # Champions League
    3:   "EL",   # Europa League
    40:  "ELC",  # Championship
    79:  "BL2",  # 2. Bundesliga
    136: "SB",   # Serie B
    62:  "FL2",  # Ligue 2
    141: "SD",   # La Liga 2
}

# The-Odds-API sport keys → competition codes
ODDS_SPORT_MAP = {
    "soccer_epl":                      "PL",
    "soccer_germany_bundesliga":        "BL1",
    "soccer_italy_serie_a":             "SA",
    "soccer_spain_la_liga":             "PD",
    "soccer_france_ligue_one":          "FL1",
    "soccer_portugal_primeira_liga":    "PPL",
    "soccer_netherlands_eredivisie":    "DED",
    "soccer_uefa_champs_league":        "CL",
    "soccer_uefa_europa_league":        "EL",
}

# Ligrile acoperite
COMPETITIONS = {
    # Div 1
    "PL":  {"name": "Premier League",    "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "div": "E0"},
    "BL1": {"name": "Bundesliga",        "flag": "🇩🇪",       "div": "D1"},
    "SA":  {"name": "Serie A",           "flag": "🇮🇹",       "div": "I1"},
    "PD":  {"name": "La Liga",           "flag": "🇪🇸",       "div": "SP1"},
    "FL1": {"name": "Ligue 1",           "flag": "🇫🇷",       "div": "F1"},
    "PPL": {"name": "Primeira Liga",     "flag": "🇵🇹",       "div": "P1"},
    "DED": {"name": "Eredivisie",        "flag": "🇳🇱",       "div": "N1"},
    # European cups
    "CL":  {"name": "Champions League",  "flag": "🏆",        "div": "CL"},
    "EL":  {"name": "Europa League",     "flag": "🌍",        "div": "EL"},
    # Div 2 — model antrenat pe date complete
    "ELC": {"name": "Championship",      "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "div": "E1"},
    "BL2": {"name": "2. Bundesliga",     "flag": "🇩🇪",       "div": "D2"},
    "SB":  {"name": "Serie B",           "flag": "🇮🇹",       "div": "I2"},
    "FL2": {"name": "Ligue 2",           "flag": "🇫🇷",       "div": "F2"},
    "SD":  {"name": "La Liga 2",         "flag": "🇪🇸",       "div": "SP2"},
    # Altele
    "PD2": {"name": "Liga Portugal 2",   "flag": "🇵🇹",       "div": "P2"},
    "BSA": {"name": "Brasileirao",       "flag": "🇧🇷",       "div": "BR"},
    "CLI": {"name": "Copa Libertadores", "flag": "🌎",        "div": "CL"},
}

# Normalizare: football-data.org team name → model team name
# Formatul football-data.org: "Arsenal FC", "Manchester City FC", etc.
FDORG_TO_MODEL = {
    # Premier League
    "Arsenal FC":                "Arsenal",
    "Chelsea FC":                "Chelsea",
    "Liverpool FC":              "Liverpool",
    "Manchester City FC":        "Man City",
    "Manchester United FC":      "Man United",
    "Tottenham Hotspur FC":      "Tottenham",
    "Newcastle United FC":       "Newcastle",
    "Aston Villa FC":            "Aston Villa",
    "West Ham United FC":        "West Ham",
    "Brighton & Hove Albion FC": "Brighton",
    "Brentford FC":              "Brentford",
    "Fulham FC":                 "Fulham",
    "Crystal Palace FC":         "Crystal Palace",
    "Wolverhampton Wanderers FC":"Wolves",
    "Everton FC":                "Everton",
    "Nottingham Forest FC":      "Nott'm Forest",
    "AFC Bournemouth":           "Bournemouth",
    "Leicester City FC":         "Leicester",
    "Southampton FC":            "Southampton",
    "Ipswich Town FC":           "Ipswich",
    "Leeds United FC":           "Leeds",
    "Sheffield United FC":       "Sheffield Utd",
    "Burnley FC":                "Burnley",
    "Luton Town FC":             "Luton",
    "Watford FC":                "Watford",
    "Norwich City FC":           "Norwich",
    "Sunderland AFC":            "Sunderland",
    "Swansea City AFC":          "Swansea",
    "Stoke City FC":             "Stoke",
    "Queens Park Rangers FC":    "QPR",
    "West Bromwich Albion FC":   "West Brom",
    "Middlesbrough FC":          "Middlesbrough",
    "Huddersfield Town AFC":     "Huddersfield",
    "Cardiff City FC":           "Cardiff",
    # Bundesliga
    "FC Bayern München":         "Bayern Munich",
    "Borussia Dortmund":         "Dortmund",
    "Bayer 04 Leverkusen":       "Leverkusen",
    "RB Leipzig":                "RB Leipzig",
    "VfB Stuttgart":             "Stuttgart",
    "Borussia Mönchengladbach":  "M'gladbach",
    "Eintracht Frankfurt":       "Ein Frankfurt",
    "TSG 1899 Hoffenheim":       "Hoffenheim",
    "SC Freiburg":               "Freiburg",
    "VfL Wolfsburg":             "Wolfsburg",
    "1. FC Union Berlin":        "Union Berlin",
    "1. FSV Mainz 05":           "Mainz",
    "FC Augsburg":               "Augsburg",
    "FC Köln":                   "FC Koln",
    "Hertha BSC":                "Hertha",
    "VfL Bochum 1848":           "Bochum",
    "Werder Bremen":             "Werder Bremen",
    "SV Darmstadt 98":           "Darmstadt",
    "1. FC Heidenheim 1846":     "Heidenheim",
    "Holstein Kiel":             "Holstein Kiel",
    "FC St. Pauli 1910":         "St. Pauli",
    "Hannover 96":               "Hannover",
    "Fortuna Düsseldorf":        "Dusseldorf",
    "Hamburger SV":              "Hamburger SV",
    "Schalke 04":                "Schalke 04",
    "Arminia Bielefeld":         "Bielefeld",
    # Serie A
    "Juventus FC":               "Juventus",
    "AC Milan":                  "Milan",
    "FC Internazionale Milano":  "Inter",
    "SSC Napoli":                "Napoli",
    "AS Roma":                   "Roma",
    "SS Lazio":                  "Lazio",
    "Atalanta BC":               "Atalanta",
    "ACF Fiorentina":            "Fiorentina",
    "Torino FC":                 "Torino",
    "Bologna FC 1909":           "Bologna",
    "Genoa CFC":                 "Genoa",
    "UC Sampdoria":              "Sampdoria",
    "Udinese Calcio":            "Udinese",
    "Cagliari Calcio":           "Cagliari",
    "Hellas Verona FC":          "Verona",
    "Parma Calcio 1913":         "Parma",
    "US Sassuolo Calcio":        "Sassuolo",
    "Venezia FC":                "Venezia",
    "Spezia Calcio":             "Spezia",
    "US Salernitana 1919":       "Salernitana",
    "US Lecce":                  "Lecce",
    "Empoli FC":                 "Empoli",
    "Frosinone Calcio":          "Frosinone",
    "Como 1907":                 "Como",
    "Monza":                     "Monza",
    # La Liga
    "Real Madrid CF":            "Real Madrid",
    "FC Barcelona":              "Barcelona",
    "Atlético de Madrid":        "Ath Madrid",
    "Sevilla FC":                "Sevilla",
    "Valencia CF":               "Valencia",
    "Villarreal CF":             "Villarreal",
    "Real Betis Balompié":       "Betis",
    "Real Sociedad de Fútbol":   "Sociedad",
    "Athletic Club":             "Ath Bilbao",
    "Rayo Vallecano de Madrid":  "Rayo Vallecano",
    "RCD Espanyol de Barcelona": "Espanol",
    "Getafe CF":                 "Getafe",
    "RC Celta de Vigo":          "Celta",
    "Deportivo Alavés":          "Alaves",
    "Granada CF":                "Granada",
    "Girona FC":                 "Girona",
    "UD Las Palmas":             "Las Palmas",
    "CA Osasuna":                "Osasuna",
    "Real Valladolid CF":        "Valladolid",
    "Cádiz CF":                  "Cadiz",
    "RCD Mallorca":              "Mallorca",
    "Almería":                   "Almeria",
    "UD Almería":                "Almeria",
    "Deportivo La Coruña":       "Deportivo",
    "Leganés":                   "Leganes",
    # The-Odds-API La Liga (fara accente / forme scurte)
    "Deportivo Alaves":          "Alaves",
    "Alaves":                    "Alaves",
    "Atletico Madrid":           "Ath Madrid",
    "Club Atletico de Madrid":   "Ath Madrid",
    "Athletic Bilbao":           "Ath Bilbao",
    "Celta Vigo":                "Celta",
    "Real Betis":                "Betis",
    "Real Sociedad":             "Sociedad",
    "Espanyol":                  "Espanol",
    "Espanol":                   "Espanol",
    "Cadiz":                     "Cadiz",
    "Leganes":                   "Leganes",
    "Las Palmas":                "Las Palmas",
    # The-Odds-API Premier League
    "Manchester City":           "Man City",
    "Manchester United":         "Man United",
    "Tottenham Hotspur":         "Tottenham",
    "Nottingham Forest":         "Nott'm Forest",
    "West Ham United":           "West Ham",
    "Newcastle United":          "Newcastle",
    "Brighton and Hove Albion":  "Brighton",
    "Brighton & Hove Albion":    "Brighton",
    "Wolverhampton Wanderers":   "Wolverhampton",
    "Sheffield United":          "Sheffield Utd",
    "Leicester City":            "Leicester",
    "Luton Town":                "Luton",
    "Ipswich Town":              "Ipswich",
    "Leeds United":              "Leeds",
    # The-Odds-API Bundesliga
    "Borussia Dortmund":         "Dortmund",
    "Bayer Leverkusen":          "Leverkusen",
    "Eintracht Frankfurt":       "Ein Frankfurt",
    "Mainz 05":                  "Mainz",
    "Cologne":                   "FC Koln",
    "VfL Bochum":                "Bochum",
    "Monchengladbach":           "M'gladbach",
    "Borussia Monchengladbach":  "M'gladbach",
    # The-Odds-API Serie A
    "AC Milan":                  "Milan",
    "Inter Milan":               "Inter",
    "Internazionale":            "Inter",
    "AS Roma":                   "Roma",
    "SS Lazio":                  "Lazio",
    "Hellas Verona":             "Verona",
    # The-Odds-API Ligue 1
    "Paris Saint Germain":       "Paris SG",
    "PSG":                       "Paris SG",
    "Olympique Marseille":       "Marseille",
    "Olympique Lyonnais":        "Lyon",
    "Stade Brestois":            "Brest",
    "Lens":                      "Lens",
    "Le Havre":                  "Le Havre",
    # The-Odds-API Primeira Liga
    "Sporting CP":               "Sporting CP",
    "SL Benfica":                "Benfica",
    "Benfica":                   "Benfica",
    "Sporting Braga":            "Sp Braga",
    "SC Braga":                  "Sp Braga",
    "Vitoria Guimaraes":         "Vitoria Guimaraes",
    "Vitoria SC":                "Vitoria SC",
    "Gil Vicente":               "Gil Vicente",
    # Champions League / Europa
    "Real Madrid":               "Real Madrid",
    "FC Barcelona":              "Barcelona",
    "Barcelona":                 "Barcelona",
    # Ligue 1
    "Paris Saint-Germain FC":    "Paris SG",
    "Olympique de Marseille":    "Marseille",
    "Olympique Lyonnais":        "Lyon",
    "AS Monaco FC":              "Monaco",
    "LOSC Lille":                "Lille",
    "Stade Rennais FC 1901":     "Rennes",
    "OGC Nice":                  "Nice",
    "RC Lens":                   "Lens",
    "RC Strasbourg Alsace":      "Strasbourg",
    "Montpellier HSC":           "Montpellier",
    "Stade de Reims":            "Reims",
    "FC Nantes":                 "Nantes",
    "Toulouse FC":               "Toulouse",
    "Angers SCO":                "Angers",
    "FC Metz":                   "Metz",
    "Stade Brestois 29":         "Brest",
    "Le Havre AC":               "Le Havre",
    "AJ Auxerre":                "Auxerre",
    "AS Saint-Étienne":          "St Etienne",
    "Girondins de Bordeaux":     "Bordeaux",
    # Championship (E1)
    "Sheffield Wednesday FC":    "Sheffield Weds",
    "Millwall FC":               "Millwall",
    "Bristol City FC":           "Bristol City",
    "Hull City AFC":             "Hull",
    "Preston North End FC":      "Preston",
    "Rotherham United FC":       "Rotherham",
    "Wigan Athletic FC":         "Wigan",
    "Derby County FC":           "Derby",
    "Bolton Wanderers FC":       "Bolton",
    "Reading FC":                "Reading",
    "Birmingham City FC":        "Birmingham",
    "Blackburn Rovers FC":       "Blackburn",
    "Blackpool FC":              "Blackpool",
    "Coventry City FC":          "Coventry",
    "Oxford United FC":          "Oxford",
    "Portsmouth FC":             "Portsmouth",
    "Plymouth Argyle FC":        "Plymouth",
    "Middlesbrough FC":          "Middlesbrough",
    "Cardiff City FC":           "Cardiff",
    "Swansea City AFC":          "Swansea",
    "Bristol Rovers FC":         "Bristol Rovers",
    "Charlton Athletic FC":      "Charlton",
    "Barnsley FC":               "Barnsley",
    "Peterborough United FC":    "Peterborough",
    "Exeter City FC":            "Exeter",
    "Shrewsbury Town FC":        "Shrewsbury",
    # 2. Bundesliga (D2)
    "Hamburger SV":              "Hamburg",
    "FC Schalke 04":             "Schalke 04",
    "1. FC Nürnberg":            "Nurnberg",
    "SpVgg Greuther Fürth":      "Greuther Furth",
    "SSV Jahn Regensburg":       "Regensburg",
    "1. FC Magdeburg":           "Magdeburg",
    "SC Paderborn 07":           "Paderborn",
    "SV Sandhausen":             "Sandhausen",
    "FC Ingolstadt 04":          "Ingolstadt",
    "Dynamo Dresden":            "Dresden",
    "Erzgebirge Aue":            "Erzgebirge Aue",
    "MSV Duisburg":              "Duisburg",
    "Karlsruher SC":             "Karlsruhe",
    "SV Waldhof Mannheim":       "Mannheim",
    "Preußen Münster":           "Munster",
    "Eintracht Braunschweig":    "Braunschweig",
    "Hertha BSC":                "Hertha",
    # Serie B (I2)
    "Palermo FC":                "Palermo",
    "Brescia Calcio":            "Brescia",
    "US Ascoli":                 "Ascoli",
    "Benevento Calcio":          "Benevento",
    "US Cremonese":              "Cremonese",
    "AC Perugia Calcio":         "Perugia",
    "Pisa SC":                   "Pisa",
    "Pisa Sporting Club":        "Pisa",
    "Reggiana":                  "Reggiana",
    "Modena FC":                 "Modena",
    "Cittadella":                "Cittadella",
    "FC Südtirol":               "Sudtirol",
    "Cosenza Calcio":            "Cosenza",
    "Carrarese Calcio":          "Carrarese",
    "Mantova 1911":              "Mantova",
    "SS Juve Stabia":            "Juve Stabia",
    "Cesena FC":                 "Cesena",
    "SSC Bari":                  "Bari",
    "Catanzaro":                 "Catanzaro",
    "Frosinone Calcio":          "Frosinone",
    "Sampdoria":                 "Sampdoria",
    # Ligue 2 (F2)
    "FC Lorient":                "Lorient",
    "FC Troyes AC":              "Troyes",
    "ES Troyes AC":              "Troyes",
    "Paris FC":                  "Paris FC",
    "Valenciennes FC":           "Valenciennes",
    "Grenoble Foot 38":          "Grenoble",
    "Clermont Foot 63":          "Clermont",
    "SO Cholet":                 "Cholet",
    "USL Dunkerque":             "Dunkerque",
    "SM Caen":                   "Caen",
    "Amiens SC":                 "Amiens",
    "FC Sochaux-Montbéliard":    "Sochaux",
    "Dijon FCO":                 "Dijon",
    "Laval":                     "Laval",
    "Niort":                     "Niort",
    "Red Star FC":               "Red Star",
    "AS Nancy-Lorraine":         "Nancy",
    "US Concarneau":             "Concarneau",
    "Pau FC":                    "Pau",
    "Rodez AF":                  "Rodez",
    "Quevilly-Rouen Métropole":  "Quevilly Rouen",
    "Saint-Brieuc":              "Saint-Brieuc",
    "AC Ajaccio":                "Ajaccio",
    "Gazelec Ajaccio":           "Ajaccio GFCO",
    "Stade Lavallois":           "Laval",
    "Bastia":                    "Bastia",
    # La Liga 2 / Segunda División (SP2)
    "Real Zaragoza":             "Zaragoza",
    "Levante UD":                "Levante",
    "Real Oviedo":               "Oviedo",
    "Elche CF":                  "Elche",
    "Málaga CF":                 "Malaga",
    "Sporting de Gijón":         "Sp Gijon",
    "CD Tenerife":               "Tenerife",
    "FC Cartagena":              "Cartagena",
    "SD Huesca":                 "Huesca",
    "RC Deportivo de La Coruña": "La Coruna",
    "Deportivo de La Coruña":    "La Coruna",
    "CD Castellón":              "Castellon",
    "SD Eibar":                  "Eibar",
    "AD Alcorcón":               "Alcorcon",
    "CD Eldense":                "Eldense",
    "Racing de Santander":       "Santander",
    "CD Mirandés":               "Mirandes",
    "UD Ibiza":                  "Ibiza",
    "Albacete Balompié":         "Albacete",
    "Gimnàstic de Tarragona":    "Gimnastic",
    "CF Extremadura":            "Extremadura UD",
    "Burgos CF":                 "Burgos",
    "Real Murcia CF":            "Murcia",
    "CD Lugo":                   "Lugo",
    "UD Almería":                "Almeria",
    "Cádiz CF":                  "Cadiz",
}


def _normalize_name(raw: str, known_teams: list) -> str:
    """
    Incearca sa normalizeze numele echipei din football-data.org
    catre formatul din modelul nostru.
    1. Lookup direct in FDORG_TO_MODEL
    2. Fuzzy match contra known_teams
    """
    # Lookup direct
    if raw in FDORG_TO_MODEL:
        return FDORG_TO_MODEL[raw]

    # Curata sufixe comune
    cleaned = raw
    for suffix in [" FC", " AFC", " CF", " SC", " AC", " United", " City"]:
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)].strip()
            break

    if cleaned in known_teams:
        return cleaned

    # Fuzzy match (cutoff 0.7)
    matches = get_close_matches(cleaned, known_teams, n=1, cutoff=0.70)
    if matches:
        return matches[0]

    # Fuzzy match pe raw
    matches2 = get_close_matches(raw, known_teams, n=1, cutoff=0.65)
    if matches2:
        return matches2[0]

    return raw  # Returnam originalul daca nu gasim


def _parse_matches(data: dict, known_teams: list, default_date: str = "") -> list:
    """Proceseaza lista de meciuri returnata de football-data.org."""
    fixtures = []
    # Echipe din afara Europei — nu le predictam (date insuficiente in model)
    NON_EUROPEAN = {
        "Cruzeiro", "Flamengo", "Fluminense", "Palmeiras", "Santos", "São Paulo",
        "Corinthians", "Atletico Mineiro", "Botafogo", "Gremio", "Internacional",
        "River Plate", "Boca Juniors", "Racing Club", "Independiente", "Estudiantes",
        "Al Ahly", "Al Hilal", "Al Nassr", "Al Ittihad", "Urawa Red Diamonds",
        "Seattle Sounders", "New York City", "LA Galaxy", "Inter Miami", "Portland Timbers",
        "CF Monterrey", "Club America", "Auckland City", "Ulsan HD",
        "Mamelodi Sundowns", "ES Tunis", "Wydad AC",
    }

    for m in data.get("matches", []):
        comp_code = m.get("competition", {}).get("code", "")
        comp_name = m.get("competition", {}).get("name", "")

        # Exclude FIFA Club World Cup si alte competitii non-europene
        if any(kw in comp_name for kw in ("Club World", "Intercontinental", "Libertadores", "Brasileirao", "MLS")):
            continue
        if comp_code not in COMPETITIONS:
            continue
        home_raw = m.get("homeTeam", {}).get("name", "")
        away_raw = m.get("awayTeam", {}).get("name", "")
        status   = m.get("status", "")
        if not home_raw or not away_raw:
            continue
        # Acceptam doar meciuri nepornite inca
        if status not in ("TIMED", "SCHEDULED"):
            continue

        comp = COMPETITIONS[comp_code]
        home = _normalize_name(home_raw, known_teams or [])
        away = _normalize_name(away_raw, known_teams or [])

        time_str  = ""
        match_date = default_date
        utc_str = m.get("utcDate", "")
        if utc_str:
            try:
                dt = datetime.datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
                match_date = dt.strftime("%Y-%m-%d")
                dt_local = dt.astimezone(BUCHAREST_TZ)   # UTC → ora Bucuresti (auto DST)
                time_str = dt_local.strftime("%H:%M")
            except Exception:
                pass

        fixtures.append({
            "home":             home,
            "away":             away,
            "home_raw":         home_raw,
            "away_raw":         away_raw,
            "league":           comp["name"],
            "flag":             comp["flag"],
            "div":              comp["div"],
            "time":             time_str,
            "date":             match_date,
            "competition_code": comp_code,
            "status":           status,
        })
    return fixtures


def _fetch_fixtures_per_competition(date_str: str, known_teams: list) -> list:
    """
    Fetch fixtures din football-data.org per competitie (TIER_ONE compatible).
    Endpoint: /competitions/{code}/matches?dateFrom=...&dateTo=...
    Delay 6s intre request-uri pentru a respecta limita de 10 req/min.
    """
    import time
    if not API_KEY:
        return []
    if cb.is_open("football-data"):
        logger.warning("[fixtures] football-data: circuit deschis, skip fetch")
        return []
    headers = {"X-Auth-Token": API_KEY}
    fixtures = []
    TIER_ONE_CODES = ["PL", "BL1", "SA", "PD", "FL1", "DED", "PPL", "CL", "ELC", "BL2"]
    for i, code in enumerate(TIER_ONE_CODES):
        if i > 0:
            time.sleep(6)
        try:
            resp = requests.get(
                f"{BASE_URL}/competitions/{code}/matches",
                headers=headers,
                params={"dateFrom": date_str, "dateTo": date_str, "status": "TIMED,SCHEDULED"},
                timeout=15,
            )
            if resp.status_code == 403:
                continue
            if resp.status_code == 429:
                cb.record_failure("football-data")
                logger.warning("[fixtures] football-data: rate limit 429 la %s", code)
                time.sleep(30)
                resp = requests.get(
                    f"{BASE_URL}/competitions/{code}/matches",
                    headers=headers,
                    params={"dateFrom": date_str, "dateTo": date_str, "status": "TIMED,SCHEDULED"},
                    timeout=15,
                )
            if resp.status_code != 200:
                continue
            parsed = _parse_matches(resp.json(), known_teams, default_date=date_str)
            fixtures.extend(parsed)
        except Exception as e:
            cb.record_failure("football-data")
            logger.warning("[fixtures] football-data: exceptie la %s: %s", code, e)
            continue
    if fixtures:
        cb.record_success("football-data")
    return fixtures


def _fetch_fixtures_api_football(date_str: str, known_teams: list) -> list:
    """
    Fetch fixture-uri din api-football.com pentru o data data.
    Returneaza lista normalizata de meciuri TIMED/SCHEDULED.
    """
    if not AF_KEY:
        return []
    if cb.is_open("api-football"):
        logger.warning("[fixtures] api-football: circuit deschis, skip fetch")
        return []
    headers = {"x-apisports-key": AF_KEY}
    season = datetime.date.fromisoformat(date_str).year
    # Daca suntem in prima jumatate a anului, sezonul e cel anterior
    if datetime.date.fromisoformat(date_str).month < 7:
        season -= 1

    fixtures = []
    for league_id, comp_code in AF_LEAGUE_MAP.items():
        try:
            resp = requests.get(
                f"{AF_BASE_URL}/fixtures",
                headers=headers,
                params={"date": date_str, "league": league_id, "season": season},
                timeout=15,
            )
            if resp.status_code == 429:
                cb.record_failure("api-football")
                logger.warning("[fixtures] api-football: rate limit 429 la liga %s", league_id)
                continue
            if resp.status_code != 200:
                continue
            data = resp.json()
            comp = COMPETITIONS.get(comp_code, {})
            for fx in data.get("response", []):
                status = fx.get("fixture", {}).get("status", {}).get("short", "")
                if status not in ("NS", "TBD"):  # NS = Not Started, TBD = To Be Defined
                    continue
                home_raw = fx.get("teams", {}).get("home", {}).get("name", "")
                away_raw = fx.get("teams", {}).get("away", {}).get("name", "")
                if not home_raw or not away_raw:
                    continue
                utc_str = fx.get("fixture", {}).get("date", "")
                time_str = ""
                match_date = date_str
                if utc_str:
                    try:
                        dt = datetime.datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
                        match_date = dt.strftime("%Y-%m-%d")
                        dt_local = dt.astimezone(BUCHAREST_TZ)
                        time_str = dt_local.strftime("%H:%M")
                    except Exception:
                        pass
                home = _normalize_name(home_raw, known_teams or [])
                away = _normalize_name(away_raw, known_teams or [])
                fixtures.append({
                    "home":             home,
                    "away":             away,
                    "home_raw":         home_raw,
                    "away_raw":         away_raw,
                    "league":           comp.get("name", comp_code),
                    "flag":             comp.get("flag", "🏆"),
                    "div":              comp.get("div", ""),
                    "time":             time_str,
                    "date":             match_date,
                    "competition_code": comp_code,
                    "status":           "TIMED",
                })
        except Exception as e:
            cb.record_failure("api-football")
            logger.warning("[fixtures] api-football: exceptie liga %s: %s", league_id, e)
            continue
    if fixtures:
        cb.record_success("api-football")
    return fixtures


def fetch_competition_fixtures(code: str, date_from: str, date_to: str,
                               known_teams: list, _debug: dict = None) -> list:
    """
    Fetch meciuri pentru o singura competitie pe un interval de date.
    Foloseste /competitions/{code}/matches — functioneaza pe TIER_ONE.
    """
    if not API_KEY:
        if _debug is not None:
            _debug["http_status"] = 0
            _debug["error"] = "FOOTBALL_DATA_KEY not set"
        return []
    headers = {"X-Auth-Token": API_KEY}
    params  = {"dateFrom": date_from, "dateTo": date_to, "status": "TIMED,SCHEDULED"}
    try:
        resp = requests.get(
            f"{BASE_URL}/competitions/{code}/matches",
            headers=headers, params=params, timeout=20
        )
        if _debug is not None:
            _debug["http_status"] = resp.status_code
            if resp.status_code != 200:
                try:
                    _debug["error"] = resp.json().get("message", resp.text[:200])
                except Exception:
                    _debug["error"] = resp.text[:200]
        if resp.status_code != 200:
            return []
        data = resp.json()
        if _debug is not None:
            _debug["raw_match_count"] = len(data.get("matches", []))
        return _parse_matches(data, known_teams, default_date=date_from)
    except Exception as e:
        if _debug is not None:
            _debug["http_status"] = -1
            _debug["error"] = str(e)
        return []


def _fetch_fixtures_for_range(date_from: str, date_to: str, known_teams: list,
                              _debug: dict = None) -> list:
    """
    Fetch meciuri pentru un interval de date intr-un singur request.
    _debug: dict optional — se populeaza cu http_status si error daca e furnizat.
    """
    if not API_KEY:
        if _debug is not None:
            _debug["http_status"] = 0
            _debug["error"] = "FOOTBALL_DATA_KEY not set"
        return []
    headers = {"X-Auth-Token": API_KEY}
    params  = {"dateFrom": date_from, "dateTo": date_to}
    try:
        resp = requests.get(f"{BASE_URL}/matches", headers=headers, params=params, timeout=20)
        if _debug is not None:
            _debug["http_status"] = resp.status_code
            if resp.status_code != 200:
                try:
                    _debug["error"] = resp.json().get("message", resp.text[:200])
                except Exception:
                    _debug["error"] = resp.text[:200]
        if resp.status_code != 200:
            return []
        data = resp.json()
        if _debug is not None:
            _debug["raw_match_count"] = len(data.get("matches", []))
        return _parse_matches(data, known_teams, default_date=date_from)
    except Exception as e:
        if _debug is not None:
            _debug["http_status"] = -1
            _debug["error"] = str(e)
        return []


def _fetch_fixtures_for_date(target: str, known_teams: list) -> list:
    """Fetch meciuri dintr-o singura data."""
    return _fetch_fixtures_for_range(target, target, known_teams)


def _fetch_af_missing_leagues(date_str: str, known_teams: list, existing: list) -> list:
    """
    Fetch ligi neacoperite de football-data.org free tier via api-football.com.
    Folosit doar pentru EL (Europa League) si altele care returneaza 403.
    Consum: 1 req/liga/zi — minim posibil.
    """
    if not AF_KEY:
        return []

    # Ligile care NU sunt in free tier football-data.org
    MISSING_LEAGUES: dict = {}  # EL scos — API-Football free nu acoperă EL

    # Elimina ligile care au deja meciuri din alte surse
    existing_codes = {f.get("competition_code") for f in existing}
    to_fetch = {lid: code for lid, code in MISSING_LEAGUES.items() if code not in existing_codes}
    if not to_fetch:
        return []

    season = datetime.date.fromisoformat(date_str).year
    if datetime.date.fromisoformat(date_str).month < 7:
        season -= 1

    fixtures = []
    headers = {"x-apisports-key": AF_KEY}
    for league_id, comp_code in to_fetch.items():
        try:
            resp = requests.get(
                f"{AF_BASE_URL}/fixtures",
                headers=headers,
                params={"date": date_str, "league": league_id, "season": season},
                timeout=15,
            )
            if resp.status_code != 200:
                continue
            comp = COMPETITIONS.get(comp_code, {})
            for fx in resp.json().get("response", []):
                status = fx.get("fixture", {}).get("status", {}).get("short", "")
                if status not in ("NS", "TBD"):
                    continue
                home_raw = fx.get("teams", {}).get("home", {}).get("name", "")
                away_raw = fx.get("teams", {}).get("away", {}).get("name", "")
                if not home_raw or not away_raw:
                    continue
                utc_str = fx.get("fixture", {}).get("date", "")
                time_str = ""
                if utc_str:
                    try:
                        dt = datetime.datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
                        time_str = dt.astimezone(BUCHAREST_TZ).strftime("%H:%M")
                    except Exception:
                        pass
                fixtures.append({
                    "home":             _normalize_name(home_raw, known_teams),
                    "away":             _normalize_name(away_raw, known_teams),
                    "home_raw":         home_raw,
                    "away_raw":         away_raw,
                    "league":           comp.get("name", comp_code),
                    "flag":             comp.get("flag", "🌍"),
                    "div":              comp.get("div", ""),
                    "time":             time_str,
                    "date":             date_str,
                    "competition_code": comp_code,
                    "status":           "TIMED",
                })
        except Exception as e:
            print(f"[af_missing] Eroare {comp_code}: {e}")
    return fixtures


def get_today_fixtures(date: Optional[str] = None, known_teams: list = None) -> list:
    """
    Returneaza meciurile pentru data ceruta (default: azi).
    Prioritate: api-football.com → football-data.org fallback.
    - Daca 'date' e specificat explicit, returneaza doar pentru acea zi (fara look-ahead).
    - Daca nu e specificat (default azi), cauta maxim 4 zile inainte daca azi nu are meciuri.
    """
    base = datetime.date.fromisoformat(date) if date else datetime.date.today()
    date_requested_explicitly = date is not None

    if date_requested_explicitly:
        fixtures = []
        if API_KEY:
            fixtures = _fetch_fixtures_per_competition(base.isoformat(), known_teams or [])
        # Adauga EL si alte ligi neacoperite de football-data.org free tier
        fixtures += _fetch_af_missing_leagues(base.isoformat(), known_teams or [], fixtures)
        return fixtures

    # Default (azi) → look-ahead maxim 4 zile
    for offset in range(5):
        target = (base + datetime.timedelta(days=offset)).isoformat()
        fixtures = []
        if API_KEY:
            fixtures = _fetch_fixtures_per_competition(target, known_teams or [])
        fixtures += _fetch_af_missing_leagues(target, known_teams or [], fixtures)
        if fixtures:
            if offset > 0:
                print(f"    Azi nu sunt meciuri — am gasit {len(fixtures)} in {target}")
            return fixtures

    return []


def _fetch_european_cups(date_str: str, known_teams: list) -> list:
    """
    Fetch specific pentru CL si EL via /competitions/{code}/matches.
    Folosit ca fallback cand /matches general nu returneaza cupele europene.
    """
    if not API_KEY:
        return []
    headers = {"X-Auth-Token": API_KEY}
    results = []
    for code in ("CL",):
        try:
            resp = requests.get(
                f"{BASE_URL}/competitions/{code}/matches",
                headers=headers,
                params={"dateFrom": date_str, "dateTo": date_str, "status": "TIMED,SCHEDULED"},
                timeout=15,
            )
            if resp.status_code == 200:
                parsed = _parse_matches(resp.json(), known_teams, default_date=date_str)
                results.extend(parsed)
        except Exception:
            pass
    return results


# Ligi cu date de injuries fiabile pe Free tier
_INJURY_LEAGUE_IDS = [39, 78, 135, 140, 61]  # EPL, Bundesliga, Serie A, La Liga, Ligue 1


def get_injuries_today(known_teams: list = None) -> dict:
    """
    Fetch absente confirmate ('Missing Fixture') pentru cele 5 ligi majore.
    Returneaza: {team_name_normalized: count_absences}
    Budget: 5 requests/zi, cached 6h in Redis.
    """
    if not AF_KEY:
        return {}

    import datetime as _dt
    try:
        import cache as _rc
        cached = _rc.get("injuries_today", _dt.date.today().isoformat())
        if cached is not None:
            return cached
    except Exception:
        pass

    season = _dt.date.today().year
    if _dt.date.today().month < 7:
        season -= 1

    today_ts  = _dt.datetime.utcnow()
    window_ts = today_ts + _dt.timedelta(days=5)
    headers   = {"x-apisports-key": AF_KEY}
    known     = known_teams or []
    result: dict = {}

    for league_id in _INJURY_LEAGUE_IDS:
        try:
            r = requests.get(
                f"{AF_BASE_URL}/injuries",
                headers=headers,
                params={"league": league_id, "season": season},
                timeout=10,
            )
            if r.status_code != 200:
                continue
            for item in r.json().get("response", []):
                if item.get("player", {}).get("type") != "Missing Fixture":
                    continue
                fix_date_str = item.get("fixture", {}).get("date", "")
                try:
                    fix_dt = _dt.datetime.fromisoformat(fix_date_str.replace("Z", "+00:00")).replace(tzinfo=None)
                    if not (today_ts <= fix_dt <= window_ts):
                        continue
                except Exception:
                    continue
                team_name = item.get("team", {}).get("name", "")
                if not team_name:
                    continue
                norm = _normalize_name(team_name, known) if known else team_name.lower()
                if norm:
                    result[norm] = result.get(norm, 0) + 1
        except Exception:
            continue

    try:
        import cache as _rc
        _rc.set("injuries_today", _dt.date.today().isoformat(), result, ttl=21600)
    except Exception:
        pass

    import logging as _logging
    _logging.getLogger(__name__).info("[injuries] %d echipe cu absente confirmate", len(result))
    return result


def get_today_odds(known_teams: list = None, active_comp_codes: list = None) -> dict:
    """
    Descarca cotele de azi din The-Odds-API (gratis: 500 req/luna).
    Optimizare: fetch doar pentru ligile cu meciuri azi (active_comp_codes).
    Backup: daca quota e epuizata, returneaza cotele din ziua anterioara.
    Returneaza un dict: (home_normalized, away_normalized) -> {B365H, B365D, B365A, ...}
    """
    if not ODDS_API_KEY:
        return {}
    if cb.is_open("the-odds-api"):
        logger.warning("[fixtures] the-odds-api: circuit deschis, skip fetch")
        return {}

    import datetime as _dt
    today = _dt.date.today().isoformat()
    yesterday = (_dt.date.today() - _dt.timedelta(days=1)).isoformat()

    # Verifica cache Redis — daca avem cote pt azi, nu mai facem API calls
    try:
        import cache as redis_cache
        cached = redis_cache.get("odds_daily", today)
        if cached is not None:
            return {tuple(k.split("|")): v for k, v in cached.items()} if isinstance(cached, dict) else {}
    except Exception:
        pass

    # Verifica daca quota e epuizata — returneaza backup din ziua anterioara
    try:
        import cache as redis_cache
        if redis_cache.get("odds_quota_exhausted", today):
            yesterday_cache = redis_cache.get("odds_daily", yesterday)
            if yesterday_cache and isinstance(yesterday_cache, dict):
                return {tuple(k.split("|")): v for k, v in yesterday_cache.items()}
            return {}
    except Exception:
        pass

    # Filtreaza doar ligile cu meciuri azi — reduce request-urile de la 9 la 2-3
    sport_map = ODDS_SPORT_MAP
    if active_comp_codes:
        comp_to_sport = {v: k for k, v in ODDS_SPORT_MAP.items()}
        filtered = {comp_to_sport[c]: c for c in active_comp_codes if c in comp_to_sport}
        if filtered:
            sport_map = filtered

    odds_map = {}
    quota_exhausted = False

    for sport, comp_code in sport_map.items():
        if quota_exhausted:
            break
        try:
            url = f"{ODDS_API_URL}/sports/{sport}/odds/"
            params = {
                "apiKey":      ODDS_API_KEY,
                "regions":     "eu",
                "markets":     "h2h",
                "oddsFormat":  "decimal",
                "dateFormat":  "iso",
            }
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code == 401:
                break
            if resp.status_code == 429:
                quota_exhausted = True
                cb.record_failure("the-odds-api")
                logger.warning("[fixtures] the-odds-api: quota epuizata (429)")
                try:
                    import cache as redis_cache
                    redis_cache.set("odds_quota_exhausted", today, True, ttl=86400)
                    yesterday_cache = redis_cache.get("odds_daily", yesterday)
                    if yesterday_cache and isinstance(yesterday_cache, dict):
                        odds_map.update({tuple(k.split("|")): v for k, v in yesterday_cache.items()})
                except Exception:
                    pass
                break
            if resp.status_code == 422:
                continue
            if resp.status_code != 200:
                continue
            events = resp.json()
        except Exception:
            continue

        for ev in events:
            home_raw = ev.get("home_team", "")
            away_raw = ev.get("away_team", "")
            home = _normalize_name(home_raw, known_teams or [])
            away = _normalize_name(away_raw, known_teams or [])

            # Aduna cotele de la toti bookmakers disponibili
            all_h, all_d, all_a = [], [], []
            b365_h = b365_d = b365_a = None

            for bk in ev.get("bookmakers", []):
                for mkt in bk.get("markets", []):
                    if mkt.get("key") != "h2h":
                        continue
                    outcomes = {o["name"]: o["price"] for o in mkt.get("outcomes", [])}
                    oh = outcomes.get(ev["home_team"])
                    od = outcomes.get("Draw")
                    oa = outcomes.get(ev["away_team"])
                    if oh and od and oa:
                        all_h.append(oh); all_d.append(od); all_a.append(oa)
                        if bk["key"] in ("bet365", "betway"):
                            b365_h, b365_d, b365_a = oh, od, oa

            if not all_h:
                continue

            avg_h = sum(all_h) / len(all_h)
            avg_d = sum(all_d) / len(all_d)
            avg_a = sum(all_a) / len(all_a)

            odds_map[(home.lower(), away.lower())] = {
                "B365H": b365_h or avg_h,
                "B365D": b365_d or avg_d,
                "B365A": b365_a or avg_a,
                "AvgH":  avg_h,
                "AvgD":  avg_d,
                "AvgA":  avg_a,
                "MaxH":  max(all_h),
                "MaxD":  max(all_d),
                "MaxA":  max(all_a),
                "PSH":   b365_h or avg_h,
                "PSD":   b365_d or avg_d,
                "PSA":   b365_a or avg_a,
            }

    # Salveaza in Redis cu TTL 48h — backup pentru ziua urmatoare daca quota se epuizeaza
    if odds_map and not quota_exhausted:
        cb.record_success("the-odds-api")
        try:
            import cache as redis_cache
            serializable = {f"{k[0]}|{k[1]}": v for k, v in odds_map.items()}
            redis_cache.set("odds_daily", today, serializable, ttl=172800)
        except Exception:
            pass

    return odds_map


