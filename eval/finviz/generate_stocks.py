#!/usr/bin/env python3
"""Generate deterministic stock data for the Finviz eval screener."""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

RANDOM_SEED = 20260409
DEFAULT_STOCK_COUNT = 1320
OUTPUT_PATH = Path("/tmp/stocks_data.js")

SECTORS = [
    "technology",
    "healthcare",
    "financial",
    "consumer cyclical",
    "consumer defensive",
    "energy",
    "industrials",
    "basic materials",
    "real estate",
    "communication services",
    "utilities",
]

INDUSTRIES = {
    "technology": [
        "Software - Infrastructure",
        "Software - Application",
        "Semiconductors",
        "Semiconductor Equipment & Materials",
        "Computer Hardware",
        "Electronic Components",
        "Communication Equipment",
        "Solar",
    ],
    "healthcare": [
        "Drug Manufacturers - General",
        "Drug Manufacturers - Specialty & Generic",
        "Biotechnology",
        "Medical Devices",
        "Diagnostics & Research",
        "Healthcare Plans",
        "Health Information Services",
        "Medical Care Facilities",
        "Pharmaceutical Retailers",
    ],
    "financial": [
        "Banks - Diversified",
        "Banks - Regional",
        "Insurance - Diversified",
        "Insurance - Life",
        "Insurance - Property & Casualty",
        "Financial Data & Stock Exchanges",
        "Asset Management",
        "Capital Markets",
        "Insurance Brokers",
        "Credit Services",
    ],
    "consumer cyclical": [
        "Auto Manufacturers",
        "Internet Retail",
        "Specialty Retail",
        "Restaurants",
        "Apparel Retail",
        "Footwear & Accessories",
        "Home Improvement Retail",
        "Department Stores",
        "Travel Services",
        "Residential Construction",
        "Recreational Vehicles",
    ],
    "consumer defensive": [
        "Discount Stores",
        "Grocery Stores",
        "Beverages - Non-Alcoholic",
        "Beverages - Alcoholic",
        "Household & Personal Products",
        "Packaged Foods",
        "Tobacco",
        "Education & Training Services",
    ],
    "energy": [
        "Oil & Gas Integrated",
        "Oil & Gas E&P",
        "Oil & Gas Midstream",
        "Oil & Gas Equipment & Services",
        "Thermal Coal",
        "Uranium",
    ],
    "industrials": [
        "Aerospace & Defense",
        "Airlines",
        "Railroads",
        "Trucking",
        "Marine Shipping",
        "Integrated Freight & Logistics",
        "Farm & Heavy Construction Machinery",
        "Industrial Distribution",
        "Specialty Industrial Machinery",
        "Electrical Equipment & Parts",
    ],
    "basic materials": [
        "Chemicals",
        "Steel",
        "Copper",
        "Aluminum",
        "Gold",
        "Silver",
        "Other Precious Metals",
        "Coking Coal",
        "Lumber & Wood Production",
        "Paper & Paper Products",
        "Agricultural Inputs",
    ],
    "real estate": [
        "REIT - Diversified",
        "REIT - Hotel & Motel",
        "REIT - Industrial",
        "REIT - Residential",
        "REIT - Retail",
        "REIT - Healthcare",
        "REIT - Office",
        "Real Estate Services",
        "Real Estate - Development",
    ],
    "communication services": [
        "Advertising Agencies",
        "Internet Content & Information",
        "Entertainment",
        "Telecom Services",
        "Broadcasting",
        "Publishing",
    ],
    "utilities": [
        "Utilities - Regulated Electric",
        "Utilities - Regulated Gas",
        "Utilities - Regulated Water",
        "Utilities - Renewable",
        "Utilities - Diversified",
    ],
}

COUNTRIES = [
    "usa",
    "usa",
    "usa",
    "usa",
    "usa",
    "china",
    "china",
    "uk",
    "germany",
    "japan",
    "canada",
    "france",
    "india",
    "australia",
    "brazil",
    "south korea",
    "switzerland",
    "taiwan",
]

EXCHANGES = ["nasd", "nyse", "amex", "cboe"]
INDEXES = ["sp500", "ndx", "dji", "rut", ""]

COMPANY_PREFIXES = [
    "Advanced",
    "American",
    "Atlas",
    "Continental",
    "Digital",
    "First",
    "Frontier",
    "Global",
    "Horizon",
    "Innovative",
    "National",
    "Nexus",
    "Pacific",
    "Pinnacle",
    "Quantum",
    "Sterling",
    "Summit",
    "United",
    "Vertex",
]

COMPANY_SUFFIXES = [
    "Corp",
    "Group",
    "Holdings",
    "Industries",
    "Labs",
    "Partners",
    "Resources",
    "Systems",
    "Technologies",
]

THEMES = ["ai", "ev", "cloud", "cybersecurity", "iot", "5g", "blockchain", "robotics"]
SUBTHEMES = ["ml", "nlp", "computervision", "autonomous", "battery"]

KNOWN_STOCKS = [
    {
        "ticker": "AAPL",
        "company": "Apple Inc",
        "sector": "technology",
        "industry": "Consumer Electronics",
        "country": "usa",
        "exchange": "nasd",
        "index": "sp500",
        "themes": ["ai", "iot"],
        "subthemes": ["ml"],
    },
    {
        "ticker": "MSFT",
        "company": "Microsoft Corporation",
        "sector": "technology",
        "industry": "Software - Infrastructure",
        "country": "usa",
        "exchange": "nasd",
        "index": "sp500",
        "themes": ["ai", "cloud", "cybersecurity"],
        "subthemes": ["ml", "nlp"],
    },
    {
        "ticker": "NVDA",
        "company": "NVIDIA Corporation",
        "sector": "technology",
        "industry": "Semiconductors",
        "country": "usa",
        "exchange": "nasd",
        "index": "sp500",
        "themes": ["ai", "robotics"],
        "subthemes": ["computervision"],
    },
    {
        "ticker": "AMZN",
        "company": "Amazon.com Inc",
        "sector": "consumer cyclical",
        "industry": "Internet Retail",
        "country": "usa",
        "exchange": "nasd",
        "index": "sp500",
        "themes": ["cloud", "ai"],
        "subthemes": ["nlp"],
    },
    {
        "ticker": "GOOGL",
        "company": "Alphabet Inc Class A",
        "sector": "communication services",
        "industry": "Internet Content & Information",
        "country": "usa",
        "exchange": "nasd",
        "index": "sp500",
        "themes": ["ai", "cloud"],
        "subthemes": ["nlp", "computervision"],
    },
    {
        "ticker": "META",
        "company": "Meta Platforms Inc",
        "sector": "communication services",
        "industry": "Internet Content & Information",
        "country": "usa",
        "exchange": "nasd",
        "index": "sp500",
        "themes": ["ai", "iot"],
        "subthemes": ["computervision"],
    },
    {
        "ticker": "TSLA",
        "company": "Tesla Inc",
        "sector": "consumer cyclical",
        "industry": "Auto Manufacturers",
        "country": "usa",
        "exchange": "nasd",
        "index": "sp500",
        "themes": ["ev", "robotics"],
        "subthemes": ["autonomous", "battery"],
    },
    {
        "ticker": "BRK.B",
        "company": "Berkshire Hathaway Inc Class B",
        "sector": "financial",
        "industry": "Insurance - Diversified",
        "country": "usa",
        "exchange": "nyse",
        "index": "sp500",
    },
    {
        "ticker": "JPM",
        "company": "JPMorgan Chase & Co",
        "sector": "financial",
        "industry": "Banks - Diversified",
        "country": "usa",
        "exchange": "nyse",
        "index": "sp500",
        "themes": ["blockchain"],
    },
    {
        "ticker": "V",
        "company": "Visa Inc Class A",
        "sector": "financial",
        "industry": "Financial Data & Stock Exchanges",
        "country": "usa",
        "exchange": "nyse",
        "index": "sp500",
        "themes": ["blockchain"],
    },
    {
        "ticker": "XOM",
        "company": "Exxon Mobil Corporation",
        "sector": "energy",
        "industry": "Oil & Gas Integrated",
        "country": "usa",
        "exchange": "nyse",
        "index": "sp500",
    },
    {
        "ticker": "TMO",
        "company": "Thermo Fisher Scientific Inc",
        "sector": "healthcare",
        "industry": "Diagnostics & Research",
        "country": "usa",
        "exchange": "nyse",
        "index": "sp500",
        "themes": ["ai"],
        "subthemes": ["ml"],
    },
    {
        "ticker": "PLTR",
        "company": "Palantir Technologies Inc",
        "sector": "technology",
        "industry": "Software - Infrastructure",
        "country": "usa",
        "exchange": "nasd",
        "index": "ndx",
        "themes": ["ai", "cybersecurity"],
        "subthemes": ["nlp"],
    },
    {
        "ticker": "CRWD",
        "company": "CrowdStrike Holdings Inc",
        "sector": "technology",
        "industry": "Software - Application",
        "country": "usa",
        "exchange": "nasd",
        "index": "ndx",
        "themes": ["cybersecurity", "cloud"],
    },
    {
        "ticker": "PANW",
        "company": "Palo Alto Networks Inc",
        "sector": "technology",
        "industry": "Software - Application",
        "country": "usa",
        "exchange": "nasd",
        "index": "ndx",
        "themes": ["cybersecurity", "cloud"],
    },
]


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def choose_weighted(
    rng: random.Random, weighted_values: list[tuple[float, float]]
) -> float:
    total = sum(weight for _, weight in weighted_values)
    pivot = rng.uniform(0, total)
    running = 0.0
    for value, weight in weighted_values:
        running += weight
        if pivot <= running:
            return value
    return weighted_values[-1][0]


def generate_company_name(rng: random.Random, industry: str) -> str:
    prefix = rng.choice(COMPANY_PREFIXES)
    suffix = rng.choice(COMPANY_SUFFIXES)
    keywords = [word for word in re.split(r"[^A-Za-z]+", industry) if len(word) > 2]
    if keywords and rng.random() < 0.55:
        return f"{prefix} {rng.choice(keywords)} {suffix}"
    return f"{prefix} {suffix}"


def generate_ticker(
    company_name: str, used_tickers: set[str], preferred: str | None = None
) -> str:
    if preferred and preferred not in used_tickers:
        used_tickers.add(preferred)
        return preferred

    words = [re.sub(r"[^A-Z]", "", part.upper()) for part in company_name.split()]
    words = [part for part in words if part]
    if words:
        base = "".join(word[0] for word in words[:4]) or words[0][:4]
    else:
        base = "TICK"
    base = base[:4]
    if len(base) < 3:
        base = (base + "XYZ")[:3]

    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    ticker = base
    counter = 0
    while ticker in used_tickers:
        suffix = alphabet[counter % 26]
        if counter >= 26:
            suffix = alphabet[(counter // 26) - 1] + suffix
        prefix_len = max(1, 5 - len(suffix))
        ticker = f"{base[:prefix_len]}{suffix}"[:5]
        counter += 1

    used_tickers.add(ticker)
    return ticker


def generate_market_cap(rng: random.Random, is_etf: bool = False) -> float:
    if is_etf:
        buckets = [
            (12000.0, 1.0),
            (28000.0, 1.2),
            (75000.0, 1.0),
            (185000.0, 0.7),
        ]
        baseline = choose_weighted(rng, buckets)
        return rng.uniform(baseline * 0.75, baseline * 1.35)

    bucket = rng.random()
    if bucket < 0.10:
        return rng.uniform(10, 50)
    if bucket < 0.23:
        return rng.uniform(50, 300)
    if bucket < 0.42:
        return rng.uniform(300, 2000)
    if bucket < 0.66:
        return rng.uniform(2000, 10000)
    if bucket < 0.88:
        return rng.uniform(10000, 200000)
    return rng.uniform(200000, 3500000)


def generate_price(
    rng: random.Random, market_cap: float, is_etf: bool = False
) -> float:
    if is_etf:
        return round(rng.uniform(18, 480), 2)

    bands = [
        ((0.2, 1.0), 0.12),
        ((1.0, 2.0), 0.08),
        ((2.0, 5.0), 0.12),
        ((5.0, 10.0), 0.12),
        ((10.0, 20.0), 0.14),
        ((20.0, 50.0), 0.18),
        ((50.0, 100.0), 0.13),
        ((100.0, 250.0), 0.08),
        ((250.0, 800.0), 0.03),
    ]
    lower, upper = choose_weighted(
        rng, [((low, high), weight) for (low, high), weight in bands]
    )
    price = rng.uniform(lower, upper)
    if market_cap > 250000 and price < 20:
        price = rng.uniform(20, 180)
    return round(price, 2)


def generate_pe(rng: random.Random, sector: str, is_etf: bool = False) -> float:
    if is_etf:
        return round(rng.uniform(10, 30), 1)

    if sector == "technology":
        bounds = (8, 90)
    elif sector == "healthcare":
        bounds = (7, 65)
    elif sector == "financial":
        bounds = (5, 22)
    elif sector == "utilities":
        bounds = (8, 30)
    elif sector == "energy":
        bounds = (4, 24)
    else:
        bounds = (6, 45)
    return round(rng.uniform(*bounds), 1)


def generate_dividend_yield(
    rng: random.Random, sector: str, is_etf: bool = False
) -> float:
    if is_etf:
        return round(rng.uniform(0.5, 6.5), 2)

    if sector in {
        "utilities",
        "financial",
        "energy",
        "consumer defensive",
        "real estate",
    }:
        upper = 8.5
    elif sector in {"technology", "communication services"}:
        upper = 2.5
    else:
        upper = 4.5
    if rng.random() < 0.03:
        return round(rng.uniform(10.5, 14.0), 2)
    if rng.random() < 0.12:
        return 0.0
    return round(rng.uniform(0.1, upper), 2)


def generate_analyst_recom(rng: random.Random) -> float:
    if rng.random() < 0.08:
        return round(rng.uniform(4.5, 5.0), 1)
    if rng.random() < 0.12:
        return round(rng.uniform(1.0, 1.5), 1)
    return round(rng.uniform(1.4, 4.2), 1)


def generate_short_float(rng: random.Random) -> float:
    if rng.random() < 0.10:
        return round(rng.uniform(20.5, 35.0), 2)
    return round(rng.uniform(0.1, 18.0), 2)


def generate_rsi(rng: random.Random) -> float:
    bucket = rng.random()
    if bucket < 0.12:
        return round(rng.uniform(18.0, 29.5), 1)
    if bucket > 0.88:
        return round(rng.uniform(70.5, 84.0), 1)
    return round(rng.uniform(30.0, 69.5), 1)


def generate_beta(rng: random.Random) -> float:
    if rng.random() < 0.12:
        return round(rng.uniform(0.15, 0.49), 2)
    if rng.random() > 0.88:
        return round(rng.uniform(2.01, 2.8), 2)
    return round(rng.uniform(0.5, 2.0), 2)


def generate_volatility(rng: random.Random) -> float:
    if rng.random() < 0.10:
        return round(rng.uniform(0.5, 1.9), 1)
    if rng.random() > 0.90:
        return round(rng.uniform(5.1, 8.4), 1)
    return round(rng.uniform(2.0, 5.0), 1)


def generate_relative_volume(rng: random.Random) -> float:
    bands = [
        (rng.uniform(0.15, 0.49), 0.10),
        (rng.uniform(0.5, 0.99), 0.24),
        (rng.uniform(1.0, 1.49), 0.26),
        (rng.uniform(1.5, 1.99), 0.18),
        (rng.uniform(2.0, 2.99), 0.15),
        (rng.uniform(3.0, 4.4), 0.07),
    ]
    return round(choose_weighted(rng, bands), 2)


def generate_avg_volume(
    rng: random.Random, market_cap: float, is_etf: bool = False
) -> int:
    if market_cap < 50:
        bounds = (5_000, 120_000)
    elif market_cap < 300:
        bounds = (20_000, 400_000)
    elif market_cap < 2_000:
        bounds = (50_000, 1_200_000)
    elif market_cap < 10_000:
        bounds = (100_000, 2_000_000)
    elif market_cap < 200_000:
        bounds = (200_000, 5_500_000)
    else:
        bounds = (800_000, 18_000_000)
    if is_etf:
        bounds = (300_000, 15_000_000)
    return int(rng.uniform(*bounds))


def generate_change(rng: random.Random) -> float:
    if rng.random() < 0.12:
        return round(rng.uniform(5.1, 12.0), 2)
    if rng.random() > 0.88:
        return round(rng.uniform(-12.0, -5.1), 2)
    return round(rng.uniform(-4.9, 4.9), 2)


def generate_growth_metric(rng: random.Random, positive_bias: float = 0.62) -> float:
    if rng.random() < 0.18:
        return round(rng.uniform(-18.0, -1.0), 1)
    if rng.random() > 0.86:
        return round(rng.uniform(25.5, 80.0), 1)
    if rng.random() < positive_bias:
        return round(rng.uniform(0.5, 24.5), 1)
    return round(rng.uniform(-10.0, 9.5), 1)


def generate_roe(rng: random.Random) -> float:
    if rng.random() < 0.12:
        return round(rng.uniform(-8.0, -0.5), 1)
    if rng.random() > 0.88:
        return round(rng.uniform(20.5, 38.0), 1)
    return round(rng.uniform(0.5, 19.5), 1)


def generate_roa(rng: random.Random) -> float:
    if rng.random() < 0.14:
        return round(rng.uniform(-4.0, -0.5), 1)
    if rng.random() > 0.87:
        return round(rng.uniform(10.5, 18.0), 1)
    return round(rng.uniform(0.4, 9.8), 1)


def generate_debt_equity(rng: random.Random, sector: str) -> float:
    if sector == "financial":
        bounds = (0.1, 2.0)
    elif sector == "technology":
        bounds = (0.05, 1.4)
    else:
        bounds = (0.05, 2.4)
    if rng.random() < 0.12:
        return round(rng.uniform(0.05, 0.45), 2)
    if rng.random() > 0.88:
        return round(rng.uniform(1.05, 2.8), 2)
    return round(rng.uniform(*bounds), 2)


def generate_date_bucket(rng: random.Random, buckets: list[tuple[int, float]]) -> int:
    return int(choose_weighted(rng, [(float(day), weight) for day, weight in buckets]))


def infer_themes(sector: str, industry: str, rng: random.Random) -> list[str]:
    industry_slug = slugify(industry)
    candidates: list[str] = []

    if sector == "technology" or industry_slug in {
        "softwareinfrastructure",
        "softwareapplication",
        "semiconductors",
        "communicationequipment",
        "electroniccomponents",
        "medicaldevices",
    }:
        candidates.append("ai")
    if industry_slug in {"automanufacturers", "electricalequipmentparts"}:
        candidates.append("ev")
    if industry_slug in {"softwareinfrastructure", "internetcontentinformation"}:
        candidates.append("cloud")
    if industry_slug in {
        "softwareapplication",
        "softwareinfrastructure",
        "communicationequipment",
    }:
        candidates.append("cybersecurity")
    if industry_slug in {
        "communicationequipment",
        "electroniccomponents",
        "semiconductors",
    }:
        candidates.append("iot")
    if industry_slug in {"telecomservices", "communicationequipment", "semiconductors"}:
        candidates.append("5g")
    if industry_slug in {
        "financialdatastockexchanges",
        "softwareapplication",
        "capitalmarkets",
    }:
        candidates.append("blockchain")
    if industry_slug in {
        "aerospacedefense",
        "specialtyindustrialmachinery",
        "semiconductors",
    }:
        candidates.append("robotics")

    themes: list[str] = []
    for candidate in candidates:
        if candidate not in themes and rng.random() < 0.55:
            themes.append(candidate)
    if not themes and rng.random() < 0.10:
        themes.append(rng.choice(THEMES))
    return themes[:2]


def infer_subthemes(themes: list[str], rng: random.Random) -> list[str]:
    subthemes: list[str] = []
    if "ai" in themes:
        ai_subthemes = ["ml", "nlp", "computervision"]
        rng.shuffle(ai_subthemes)
        subthemes.extend(ai_subthemes[: rng.randint(1, 2)])
    if "ev" in themes and "battery" not in subthemes:
        subthemes.append("battery")
    if (
        {"ev", "robotics"} & set(themes)
        and "autonomous" not in subthemes
        and rng.random() < 0.8
    ):
        subthemes.append("autonomous")
    return subthemes[:3]


def build_stock(
    rng: random.Random,
    used_tickers: set[str],
    *,
    company: str | None = None,
    ticker: str | None = None,
    sector: str,
    industry: str,
    country: str,
    exchange: str,
    index: str,
    is_etf: bool = False,
    themes: list[str] | None = None,
    subthemes: list[str] | None = None,
    overrides: dict[str, object] | None = None,
) -> dict[str, object]:
    overrides = overrides or {}
    company_name = company or generate_company_name(rng, industry)
    ticker_symbol = generate_ticker(company_name, used_tickers, preferred=ticker)

    market_cap = float(overrides.get("marketCap", generate_market_cap(rng, is_etf)))
    price = float(overrides.get("price", generate_price(rng, market_cap, is_etf)))

    shares_outstanding = float(
        overrides.get("sharesOutstanding", max(0.2, market_cap / max(price, 0.2)))
    )
    float_pct = float(overrides.get("floatPctOutstanding", rng.uniform(6, 96)))
    float_shares = float(
        overrides.get("floatShares", shares_outstanding * (float_pct / 100.0))
    )

    avg_volume = int(
        overrides.get("avgVolume", generate_avg_volume(rng, market_cap, is_etf))
    )
    rel_volume = float(overrides.get("relVolume", generate_relative_volume(rng)))
    volume = int(overrides.get("volume", max(1, round(avg_volume * rel_volume))))

    target_gap_pct = float(
        overrides.get(
            "targetGapPct",
            choose_weighted(
                rng,
                [
                    (-24.0, 0.06),
                    (-12.0, 0.10),
                    (-4.0, 0.15),
                    (4.0, 0.18),
                    (11.0, 0.18),
                    (22.0, 0.16),
                    (34.0, 0.11),
                    (58.0, 0.06),
                ],
            ),
        )
    )
    target_price = float(
        overrides.get("targetPrice", price * (1 + target_gap_pct / 100.0))
    )

    high_distance_pct = float(
        overrides.get(
            "highDistancePct",
            choose_weighted(
                rng,
                [
                    (0.0, 0.16),
                    (2.0, 0.18),
                    (4.0, 0.14),
                    (9.0, 0.18),
                    (16.0, 0.18),
                    (28.0, 0.16),
                ],
            ),
        )
    )
    low_distance_pct = float(
        overrides.get(
            "lowDistancePct",
            choose_weighted(
                rng,
                [
                    (0.0, 0.14),
                    (3.0, 0.16),
                    (6.0, 0.14),
                    (14.0, 0.18),
                    (25.0, 0.18),
                    (48.0, 0.20),
                ],
            ),
        )
    )
    high_52w = float(
        overrides.get("high52w", price / max(0.05, 1 - high_distance_pct / 100.0))
    )
    low_52w = float(
        overrides.get("low52w", price / (1 + max(-0.95, low_distance_pct / 100.0)))
    )
    if low_52w >= high_52w:
        low_52w = round(max(0.05, price * 0.72), 2)
        high_52w = round(price * 1.28, 2)

    stock_themes = themes if themes is not None else infer_themes(sector, industry, rng)
    stock_subthemes = (
        subthemes if subthemes is not None else infer_subthemes(stock_themes, rng)
    )

    stock = {
        "ticker": ticker_symbol,
        "company": company_name,
        "sector": sector,
        "industry": industry,
        "country": country,
        "exchange": exchange,
        "index": index,
        "isEtf": is_etf,
        "marketCap": round(market_cap, 1),
        "price": round(price, 2),
        "change": round(float(overrides.get("change", generate_change(rng))), 2),
        "pe": round(float(overrides.get("pe", generate_pe(rng, sector, is_etf))), 1),
        "forwardPe": round(
            float(
                overrides.get(
                    "forwardPe",
                    max(
                        1.0, generate_pe(rng, sector, is_etf) * rng.uniform(0.65, 1.05)
                    ),
                )
            ),
            1,
        ),
        "peg": round(float(overrides.get("peg", rng.uniform(0.2, 3.4))), 2),
        "ps": round(float(overrides.get("ps", rng.uniform(0.2, 12.0))), 2),
        "pb": round(float(overrides.get("pb", rng.uniform(0.3, 8.0))), 2),
        "volume": volume,
        "avgVolume": avg_volume,
        "relVolume": round(rel_volume, 2),
        "dividendYield": round(
            float(
                overrides.get(
                    "dividendYield", generate_dividend_yield(rng, sector, is_etf)
                )
            ),
            2,
        ),
        "shortFloat": round(
            float(overrides.get("shortFloat", generate_short_float(rng))), 2
        ),
        "analystRecom": round(
            float(overrides.get("analystRecom", generate_analyst_recom(rng))),
            1,
        ),
        "optionable": bool(overrides.get("optionable", rng.random() > 0.18 or is_etf)),
        "shortable": bool(overrides.get("shortable", rng.random() > 0.28)),
        "earningsDateDaysAgo": int(
            overrides.get(
                "earningsDateDaysAgo",
                generate_date_bucket(
                    rng,
                    [
                        (0, 0.03),
                        (1, 0.03),
                        (3, 0.08),
                        (6, 0.08),
                        (12, 0.18),
                        (28, 0.22),
                        (45, 0.18),
                        (90, 0.20),
                    ],
                ),
            )
        ),
        "targetPrice": round(target_price, 2),
        "targetGapPct": round(target_gap_pct, 1),
        "ipoAgeDays": int(
            overrides.get(
                "ipoAgeDays",
                generate_date_bucket(
                    rng,
                    [
                        (0, 0.02),
                        (1, 0.02),
                        (5, 0.05),
                        (20, 0.09),
                        (70, 0.14),
                        (250, 0.16),
                        (900, 0.14),
                        (2200, 0.16),
                        (4200, 0.22),
                    ],
                ),
            )
        ),
        "sharesOutstanding": round(shares_outstanding, 2),
        "floatShares": round(float_shares, 2),
        "floatPctOutstanding": round(float_pct, 2),
        "themes": stock_themes,
        "subthemes": stock_subthemes,
        "epsGrowth": round(
            float(overrides.get("epsGrowth", generate_growth_metric(rng))), 1
        ),
        "salesGrowth": round(
            float(overrides.get("salesGrowth", generate_growth_metric(rng, 0.66))), 1
        ),
        "roe": round(float(overrides.get("roe", generate_roe(rng))), 1),
        "roa": round(float(overrides.get("roa", generate_roa(rng))), 1),
        "debtEquity": round(
            float(overrides.get("debtEquity", generate_debt_equity(rng, sector))), 2
        ),
        "sma20DiffPct": round(
            float(overrides.get("sma20DiffPct", rng.uniform(-12.0, 12.0))), 1
        ),
        "sma50DiffPct": round(
            float(overrides.get("sma50DiffPct", rng.uniform(-16.0, 16.0))), 1
        ),
        "sma200DiffPct": round(
            float(overrides.get("sma200DiffPct", rng.uniform(-24.0, 24.0))), 1
        ),
        "perf1w": round(float(overrides.get("perf1w", rng.uniform(-14.0, 14.0))), 2),
        "perf4w": round(float(overrides.get("perf4w", rng.uniform(-24.0, 28.0))), 2),
        "rsi": round(float(overrides.get("rsi", generate_rsi(rng))), 1),
        "beta": round(float(overrides.get("beta", generate_beta(rng))), 2),
        "volatility": round(
            float(overrides.get("volatility", generate_volatility(rng))), 1
        ),
        "high52w": round(high_52w, 2),
        "low52w": round(max(0.05, low_52w), 2),
        "eliteOnly": bool(overrides.get("eliteOnly", rng.random() < 0.14)),
    }

    if is_etf and not stock["themes"]:
        stock["themes"] = [rng.choice(["ai", "cloud", "blockchain", "robotics"])]

    return stock


def build_coverage_stocks(
    rng: random.Random, used_tickers: set[str]
) -> list[dict[str, object]]:
    coverage: list[dict[str, object]] = []

    country_cycle = COUNTRIES.copy()
    rng.shuffle(country_cycle)
    exchange_cycle = EXCHANGES.copy()
    index_cycle = ["sp500", "ndx", "dji", "rut", ""]

    for sector, industries in INDUSTRIES.items():
        for offset, industry in enumerate(industries):
            country = country_cycle[(len(coverage) + offset) % len(country_cycle)]
            exchange = exchange_cycle[(len(coverage) + offset) % len(exchange_cycle)]
            index = index_cycle[(len(coverage) + offset) % len(index_cycle)]
            coverage.append(
                build_stock(
                    rng,
                    used_tickers,
                    company=f"{industry} Coverage",
                    sector=sector,
                    industry=industry,
                    country=country,
                    exchange=exchange,
                    index=index,
                )
            )

    coverage.append(
        build_stock(
            rng,
            used_tickers,
            company="Broad Market ETF Coverage",
            sector="financial",
            industry="Exchange Traded Fund",
            country="usa",
            exchange="amex",
            index="",
            is_etf=True,
            themes=["ai"],
        )
    )

    theme_profiles = {
        "ai": ("technology", "Software - Application", ["ml", "nlp"]),
        "ev": ("consumer cyclical", "Auto Manufacturers", ["autonomous", "battery"]),
        "cloud": ("technology", "Software - Infrastructure", ["ml"]),
        "cybersecurity": ("technology", "Software - Application", []),
        "iot": ("technology", "Electronic Components", ["computervision"]),
        "5g": ("communication services", "Telecom Services", []),
        "blockchain": ("financial", "Financial Data & Stock Exchanges", []),
        "robotics": ("industrials", "Specialty Industrial Machinery", ["autonomous"]),
    }

    for theme, (sector, industry, subthemes) in theme_profiles.items():
        coverage.append(
            build_stock(
                rng,
                used_tickers,
                company=f"{theme.upper()} Theme Coverage",
                sector=sector,
                industry=industry,
                country="usa",
                exchange="nasd",
                index="ndx",
                themes=[theme],
                subthemes=subthemes,
            )
        )

    special_profiles = [
        {
            "company": "Nano Penny Labs",
            "sector": "technology",
            "industry": "Software - Application",
            "country": "brazil",
            "exchange": "amex",
            "index": "",
            "overrides": {
                "marketCap": 22.0,
                "price": 0.42,
                "shortFloat": 28.4,
                "analystRecom": 4.8,
                "dividendYield": 0.0,
                "rsi": 23.5,
                "beta": 2.45,
                "volatility": 7.4,
                "perf1w": -8.6,
                "perf4w": -16.8,
                "sma20DiffPct": -8.4,
                "sma50DiffPct": -12.1,
                "sma200DiffPct": -18.0,
                "targetGapPct": -21.0,
                "earningsDateDaysAgo": 0,
                "ipoAgeDays": 0,
                "floatPctOutstanding": 8.0,
                "eliteOnly": True,
                "high52w": 0.61,
                "low52w": 0.46,
            },
        },
        {
            "company": "Mega Stable Utilities",
            "sector": "utilities",
            "industry": "Utilities - Regulated Gas",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
            "overrides": {
                "marketCap": 2_650_000.0,
                "price": 188.4,
                "pe": 12.4,
                "forwardPe": 11.1,
                "dividendYield": 11.2,
                "beta": 0.28,
                "volatility": 1.3,
                "rsi": 74.2,
                "perf1w": 11.4,
                "perf4w": 22.6,
                "targetGapPct": 56.0,
                "high52w": 179.1,
                "low52w": 132.2,
                "avgVolume": 6_800_000,
                "relVolume": 3.6,
                "volume": 24_480_000,
                "earningsDateDaysAgo": 1,
                "ipoAgeDays": 5_200,
                "floatPctOutstanding": 68.0,
            },
        },
        {
            "company": "Fresh Robotics Launch",
            "sector": "industrials",
            "industry": "Aerospace & Defense",
            "country": "canada",
            "exchange": "nasd",
            "index": "rut",
            "themes": ["robotics"],
            "subthemes": ["autonomous"],
            "overrides": {
                "marketCap": 420.0,
                "price": 14.8,
                "beta": 2.18,
                "volatility": 6.2,
                "rsi": 69.2,
                "targetGapPct": 31.0,
                "ipoAgeDays": 1,
                "earningsDateDaysAgo": 6,
                "high52w": 15.4,
                "low52w": 9.2,
                "floatPctOutstanding": 54.0,
            },
        },
        {
            "company": "Old School Retail",
            "sector": "consumer defensive",
            "industry": "Discount Stores",
            "country": "uk",
            "exchange": "cboe",
            "index": "dji",
            "overrides": {
                "marketCap": 1_250.0,
                "price": 7.8,
                "perf1w": -5.6,
                "perf4w": -11.2,
                "rsi": 28.8,
                "ipoAgeDays": 4_300,
                "earningsDateDaysAgo": 28,
                "targetGapPct": -12.0,
                "high52w": 9.9,
                "low52w": 7.95,
                "sma20DiffPct": -6.0,
                "sma50DiffPct": -8.0,
                "sma200DiffPct": -10.0,
            },
        },
        {
            "company": "Below Low Energy",
            "sector": "energy",
            "industry": "Oil & Gas Midstream",
            "country": "australia",
            "exchange": "amex",
            "index": "",
            "overrides": {
                "marketCap": 6_800.0,
                "price": 9.7,
                "high52w": 18.4,
                "low52w": 10.2,
                "rsi": 21.4,
                "shortFloat": 22.6,
                "targetGapPct": 18.0,
                "perf1w": -9.4,
                "perf4w": -19.8,
            },
        },
        {
            "company": "Above High Momentum",
            "sector": "communication services",
            "industry": "Internet Content & Information",
            "country": "india",
            "exchange": "nasd",
            "index": "ndx",
            "themes": ["ai", "cloud"],
            "subthemes": ["nlp"],
            "overrides": {
                "marketCap": 88_000.0,
                "price": 132.6,
                "high52w": 129.1,
                "low52w": 76.8,
                "change": 7.2,
                "rsi": 76.6,
                "perf1w": 13.4,
                "perf4w": 26.8,
                "sma20DiffPct": 8.1,
                "sma50DiffPct": 11.4,
                "sma200DiffPct": 19.6,
                "avgVolume": 4_200_000,
                "relVolume": 3.2,
                "volume": 13_440_000,
            },
        },
    ]

    for profile in special_profiles:
        coverage.append(
            build_stock(
                rng,
                used_tickers,
                company=profile["company"],
                sector=profile["sector"],
                industry=profile["industry"],
                country=profile["country"],
                exchange=profile["exchange"],
                index=profile["index"],
                themes=profile.get("themes"),
                subthemes=profile.get("subthemes"),
                overrides=profile.get("overrides"),
            )
        )

    return coverage


def generate_random_stock(
    rng: random.Random, used_tickers: set[str]
) -> dict[str, object]:
    is_etf = rng.random() < 0.05
    if is_etf:
        return build_stock(
            rng,
            used_tickers,
            sector="financial",
            industry="Exchange Traded Fund",
            country=rng.choice(COUNTRIES),
            exchange=rng.choice(["amex", "nyse", "nasd"]),
            index="",
            is_etf=True,
        )

    sector = rng.choice(SECTORS)
    return build_stock(
        rng,
        used_tickers,
        sector=sector,
        industry=rng.choice(INDUSTRIES[sector]),
        country=rng.choice(COUNTRIES),
        exchange=rng.choice(EXCHANGES),
        index=rng.choice(INDEXES),
    )


def generate_known_stocks(
    rng: random.Random, used_tickers: set[str]
) -> list[dict[str, object]]:
    known: list[dict[str, object]] = []
    for stock in KNOWN_STOCKS:
        known.append(
            build_stock(
                rng,
                used_tickers,
                ticker=stock["ticker"],
                company=stock["company"],
                sector=stock["sector"],
                industry=stock["industry"],
                country=stock["country"],
                exchange=stock["exchange"],
                index=stock["index"],
                themes=stock.get("themes"),
                subthemes=stock.get("subthemes"),
            )
        )
    return known


def generate_stocks(num_stocks: int = DEFAULT_STOCK_COUNT) -> list[dict[str, object]]:
    rng = random.Random(RANDOM_SEED)
    used_tickers: set[str] = set()

    stocks = build_coverage_stocks(rng, used_tickers)
    stocks.extend(generate_known_stocks(rng, used_tickers))

    while len(stocks) < num_stocks:
        stocks.append(generate_random_stock(rng, used_tickers))

    stocks.sort(key=lambda stock: stock["ticker"])
    return stocks


def js_value(value: object) -> str:
    return json.dumps(value, separators=(",", ":"))


def format_stock_data(stocks: list[dict[str, object]]) -> str:
    lines: list[str] = []
    for stock in stocks:
        parts = [f"{key}: {js_value(value)}" for key, value in stock.items()]
        lines.append(f"    {{{', '.join(parts)}}}")
    return "const STOCKS_DATA = [\n" + ",\n".join(lines) + "\n];"


def summarize_counts(stocks: list[dict[str, object]], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for stock in stocks:
        key = stock.get(field) or "none"
        counts[str(key)] = counts.get(str(key), 0) + 1
    return counts


if __name__ == "__main__":
    stocks = generate_stocks()
    js_code = format_stock_data(stocks)
    OUTPUT_PATH.write_text(js_code)

    print(f"Generated {len(stocks)} stocks with deterministic seed {RANDOM_SEED}")
    print(f"Wrote JavaScript data to {OUTPUT_PATH}")
    print("Sample distributions:")
    for label, field in [
        ("sector", "sector"),
        ("country", "country"),
        ("exchange", "exchange"),
    ]:
        print(f"\nBy {label}:")
        for key, count in sorted(summarize_counts(stocks, field).items()):
            print(f"  {key}: {count}")
