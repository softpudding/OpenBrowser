#!/usr/bin/env python3
# Stock Data Generator for Finviz Clone
# Generates 200+ realistic stocks with diverse attributes

import json
import random

# Data pools
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
        "Consumer Electronics",
        "Information Technology Services",
        "Computer Hardware",
        "Electronic Components",
        "Communication Equipment",
    ],
    "healthcare": [
        "Drug Manufacturers - General",
        "Drug Manufacturers - Specialty & Generic",
        "Biotechnology",
        "Medical Devices",
        "Diagnostics & Research",
        "Healthcare Plans",
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
        "Credit Services",
        "Capital Markets",
        "Insurance Brokers",
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
    ],
    "real estate": [
        "REIT - Diversified",
        "REIT - Residential",
        "REIT - Retail",
        "REIT - Office",
        "REIT - Industrial",
        "REIT - Healthcare",
        "Real Estate Services",
        "Real Estate - Development",
    ],
    "communication services": [
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
    "usa",  # More USA stocks
    "china",
    "china",
    "china",
    "uk",
    "uk",
    "germany",
    "germany",
    "japan",
    "japan",
    "switzerland",
    "canada",
    "canada",
    "france",
    "south korea",
    "taiwan",
    "india",
    "australia",
]

EXCHANGES = ["nasd", "nyse", "amex", "cboe"]
INDEXES = ["sp500", "nasdaq100", "djia", "russell2000", ""]

COMPANY_PREFIXES = [
    "Advanced",
    "American",
    "Global",
    "International",
    "National",
    "United",
    "First",
    "Premier",
    "Apex",
    "Summit",
    "Pacific",
    "Atlantic",
    "Continental",
    "Dynamic",
    "Innovative",
    "Strategic",
    "Digital",
    "Quantum",
    "Nexus",
    "Vertex",
    "Pinnacle",
    "Sterling",
]

COMPANY_SUFFIXES = [
    "Inc",
    "Corporation",
    "Ltd",
    "PLC",
    "Group",
    "Holdings",
    "Technologies",
    "Systems",
    "Solutions",
    "Industries",
    "Partners",
    "Capital",
    "Resources",
    "Energy",
    "Pharma",
    "BioTech",
    "Dynamics",
]

INDUSTRY_KEYWORDS = {
    "Software - Infrastructure": ["Cloud", "Data", "Enterprise", "Platform"],
    "Software - Application": ["App", "Mobile", "SaaS", "Digital"],
    "Semiconductors": ["Chip", "Silicon", "Micro", "Semi"],
    "Consumer Electronics": ["Tech", "Electronics", "Devices"],
    "Drug Manufacturers - General": ["Pharma", "Medicine", "Pharmaceutical"],
    "Biotechnology": ["Bio", "Genomics", "Therapeutics", "Cell"],
    "Banks - Diversified": ["Bank", "Banking", "Financial"],
    "Insurance - Diversified": ["Insurance", "Assurance", "Indemnity"],
    "Auto Manufacturers": ["Auto", "Motors", "Vehicles", "EV"],
    "Oil & Gas Integrated": ["Energy", "Petroleum", "Oil", "Gas"],
    "Aerospace & Defense": ["Aerospace", "Defense", "Aviation"],
    "Internet Content & Information": ["Net", "Web", "Online", "Media"],
    "Entertainment": ["Entertainment", "Media", "Studios", "Gaming"],
}


def generate_company_name(sector, industry):
    prefix = random.choice(COMPANY_PREFIXES)
    suffix = random.choice(COMPANY_SUFFIXES)

    # Sometimes add industry-specific keyword
    keywords = INDUSTRY_KEYWORDS.get(industry, [])
    if keywords and random.random() > 0.5:
        keyword = random.choice(keywords)
        return f"{prefix} {keyword} {suffix}"

    return f"{prefix} {suffix}"


def generate_ticker(company_name):
    # Generate 3-5 letter ticker
    words = company_name.replace(",", "").split()
    if len(words) >= 2:
        ticker = "".join([word[0].upper() for word in words[:3]])
    else:
        ticker = company_name[:4].upper()

    # Ensure unique
    ticker = ticker.replace(" ", "").replace("-", "")[:5]
    return ticker


def generate_market_cap():
    # Market cap in millions
    rand = random.random()
    if rand < 0.15:  # Mega (>200B)
        return random.uniform(200000, 3000000)
    elif rand < 0.35:  # Large (10B-200B)
        return random.uniform(10000, 200000)
    elif rand < 0.55:  # Mid (2B-10B)
        return random.uniform(2000, 10000)
    elif rand < 0.75:  # Small (300M-2B)
        return random.uniform(300, 2000)
    elif rand < 0.90:  # Micro (50M-300M)
        return random.uniform(50, 300)
    else:  # Nano (<50M)
        return random.uniform(10, 50)


def generate_price(market_cap):
    # Price based on market cap with some variation
    base_price = market_cap / random.uniform(500, 5000)
    return max(0.5, min(2000, base_price + random.uniform(-20, 50)))


def generate_pe(sector):
    # P/E ratio varies by sector
    if sector == "technology":
        return round(random.uniform(15, 120), 1)
    elif sector == "healthcare":
        return round(random.uniform(10, 80), 1)
    elif sector == "financial":
        return round(random.uniform(6, 20), 1)
    elif sector == "utilities":
        return round(random.uniform(12, 25), 1)
    elif sector == "energy":
        return round(random.uniform(5, 20), 1)
    else:
        return round(random.uniform(10, 50), 1)


def generate_change():
    # Daily change percentage
    return round(random.uniform(-5, 5), 2)


def generate_volume(market_cap):
    # Volume based on market cap
    base = market_cap * random.uniform(0.001, 0.01)
    return int(base * 1000)  # Convert to actual shares


def generate_dividend_yield(sector):
    # Dividend yield varies by sector
    if sector in ["utilities", "financial", "energy", "consumer defensive"]:
        return round(random.uniform(1, 6), 2)
    elif sector in ["technology", "communication services"]:
        return round(random.uniform(0, 1.5), 2)
    else:
        return round(random.uniform(0, 3), 2)


def generate_rsi():
    # RSI 0-100
    return round(random.uniform(25, 75), 1)


def generate_beta():
    # Beta 0.3-2.5
    return round(random.uniform(0.3, 2.5), 2)


def generate_volatility():
    # Volatility 0.5-5
    return round(random.uniform(0.5, 5), 1)


def generate_analyst_recom():
    # 1.0 (strong buy) to 5.0 (strong sell)
    return round(random.uniform(1.5, 3.5), 1)


def generate_short_float():
    return round(random.uniform(0.1, 5), 2)


def generate_52w_range(price):
    low = price * random.uniform(0.6, 0.85)
    high = price * random.uniform(1.1, 1.5)
    return round(low, 2), round(high, 2)


def generate_stocks(num_stocks=220):
    stocks = []
    used_tickers = set()

    # Ensure good distribution across sectors
    stocks_per_sector = num_stocks // len(SECTORS)

    for sector in SECTORS:
        industries = INDUSTRIES[sector]

        for _ in range(stocks_per_sector):
            industry = random.choice(industries)
            country = random.choice(COUNTRIES)
            exchange = random.choice(EXCHANGES)
            index = random.choice(INDEXES)

            # Ensure some stocks have index membership
            if random.random() < 0.3:
                index = random.choice(["sp500", "nasdaq100", "djia", "russell2000"])

            # Generate company
            company = generate_company_name(sector, industry)
            ticker = generate_ticker(company)

            # Ensure unique ticker
            counter = 1
            while ticker in used_tickers:
                ticker = (
                    f"{ticker[:3]}{counter}"
                    if len(ticker) <= 3
                    else f"{ticker[:2]}{counter}"
                )
                counter += 1
            used_tickers.add(ticker)

            market_cap = generate_market_cap()
            price = generate_price(market_cap)

            stock = {
                "ticker": ticker,
                "company": company,
                "sector": sector,
                "industry": industry,
                "country": country,
                "exchange": exchange,
                "index": index,
                "marketCap": round(market_cap, 0),
                "price": round(price, 2),
                "change": generate_change(),
                "pe": generate_pe(sector),
                "volume": generate_volume(market_cap),
                "avgVolume": int(
                    generate_volume(market_cap) * random.uniform(0.8, 1.2)
                ),
                "dividendYield": generate_dividend_yield(sector),
                "shortFloat": generate_short_float(),
                "analystRecom": generate_analyst_recom(),
                "optionable": random.random() > 0.2,
                "shortable": random.random() > 0.3,
                "rsi": generate_rsi(),
                "beta": generate_beta(),
                "volatility": generate_volatility(),
                "high52w": generate_52w_range(price)[1],
                "low52w": generate_52w_range(price)[0],
                "relVolume": round(random.uniform(0.5, 3), 2),
            }

            stocks.append(stock)

    # Add some well-known real stocks for recognition
    real_stocks = [
        {
            "ticker": "AAPL",
            "company": "Apple Inc",
            "sector": "technology",
            "industry": "Consumer Electronics",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "MSFT",
            "company": "Microsoft Corporation",
            "sector": "technology",
            "industry": "Software - Infrastructure",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "GOOGL",
            "company": "Alphabet Inc Class A",
            "sector": "communication services",
            "industry": "Internet Content & Information",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "AMZN",
            "company": "Amazon.com Inc",
            "sector": "consumer cyclical",
            "industry": "Internet Retail",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "NVDA",
            "company": "NVIDIA Corporation",
            "sector": "technology",
            "industry": "Semiconductors",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "META",
            "company": "Meta Platforms Inc",
            "sector": "communication services",
            "industry": "Internet Content & Information",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "TSLA",
            "company": "Tesla Inc",
            "sector": "consumer cyclical",
            "industry": "Auto Manufacturers",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
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
        },
        {
            "ticker": "V",
            "company": "Visa Inc Class A",
            "sector": "financial",
            "industry": "Financial Data & Stock Exchanges",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "JNJ",
            "company": "Johnson & Johnson",
            "sector": "healthcare",
            "industry": "Drug Manufacturers - General",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "WMT",
            "company": "Walmart Inc",
            "sector": "consumer defensive",
            "industry": "Discount Stores",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "PG",
            "company": "Procter & Gamble Co",
            "sector": "consumer defensive",
            "industry": "Household & Personal Products",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
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
            "ticker": "CVX",
            "company": "Chevron Corporation",
            "sector": "energy",
            "industry": "Oil & Gas Integrated",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "UNH",
            "company": "UnitedHealth Group Inc",
            "sector": "healthcare",
            "industry": "Healthcare Plans",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "HD",
            "company": "Home Depot Inc",
            "sector": "consumer cyclical",
            "industry": "Home Improvement Retail",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "MA",
            "company": "Mastercard Inc Class A",
            "sector": "financial",
            "industry": "Financial Data & Stock Exchanges",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "BAC",
            "company": "Bank of America Corp",
            "sector": "financial",
            "industry": "Banks - Diversified",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "ABBV",
            "company": "AbbVie Inc",
            "sector": "healthcare",
            "industry": "Drug Manufacturers - General",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "NFLX",
            "company": "Netflix Inc",
            "sector": "communication services",
            "industry": "Entertainment",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "CRM",
            "company": "Salesforce Inc",
            "sector": "technology",
            "industry": "Software - Application",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "ADBE",
            "company": "Adobe Inc",
            "sector": "technology",
            "industry": "Software - Application",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "COST",
            "company": "Costco Wholesale Corp",
            "sector": "consumer defensive",
            "industry": "Discount Stores",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "PEP",
            "company": "PepsiCo Inc",
            "sector": "consumer defensive",
            "industry": "Beverages - Non-Alcoholic",
            "country": "usa",
            "exchange": "nasd",
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
        },
        {
            "ticker": "MRK",
            "company": "Merck & Co Inc",
            "sector": "healthcare",
            "industry": "Drug Manufacturers - General",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "ACN",
            "company": "Accenture PLC Class A",
            "sector": "technology",
            "industry": "Information Technology Services",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "LLY",
            "company": "Eli Lilly and Co",
            "sector": "healthcare",
            "industry": "Drug Manufacturers - General",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "AVGO",
            "company": "Broadcom Inc",
            "sector": "technology",
            "industry": "Semiconductors",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "ORCL",
            "company": "Oracle Corporation",
            "sector": "technology",
            "industry": "Software - Infrastructure",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "KO",
            "company": "Coca-Cola Co",
            "sector": "consumer defensive",
            "industry": "Beverages - Non-Alcoholic",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "AMD",
            "company": "Advanced Micro Devices Inc",
            "sector": "technology",
            "industry": "Semiconductors",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "INTC",
            "company": "Intel Corporation",
            "sector": "technology",
            "industry": "Semiconductors",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "CSCO",
            "company": "Cisco Systems Inc",
            "sector": "technology",
            "industry": "Communication Equipment",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "VZ",
            "company": "Verizon Communications Inc",
            "sector": "communication services",
            "industry": "Telecom Services",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "T",
            "company": "AT&T Inc",
            "sector": "communication services",
            "industry": "Telecom Services",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "DIS",
            "company": "Walt Disney Co",
            "sector": "communication services",
            "industry": "Entertainment",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
        {
            "ticker": "CMCSA",
            "company": "Comcast Corporation Class A",
            "sector": "communication services",
            "industry": "Entertainment",
            "country": "usa",
            "exchange": "nasd",
            "index": "sp500",
        },
        {
            "ticker": "NKE",
            "company": "Nike Inc Class B",
            "sector": "consumer cyclical",
            "industry": "Footwear & Accessories",
            "country": "usa",
            "exchange": "nyse",
            "index": "sp500",
        },
    ]

    # Add real stocks with generated numeric fields
    for real in real_stocks:
        market_cap = generate_market_cap()
        price = generate_price(market_cap)

        stock = {
            **real,
            "marketCap": round(market_cap, 0),
            "price": round(price, 2),
            "change": generate_change(),
            "pe": generate_pe(real["sector"]),
            "volume": generate_volume(market_cap),
            "avgVolume": int(generate_volume(market_cap) * random.uniform(0.8, 1.2)),
            "dividendYield": generate_dividend_yield(real["sector"]),
            "shortFloat": generate_short_float(),
            "analystRecom": generate_analyst_recom(),
            "optionable": True,
            "shortable": True,
            "rsi": generate_rsi(),
            "beta": generate_beta(),
            "volatility": generate_volatility(),
            "high52w": generate_52w_range(price)[1],
            "low52w": generate_52w_range(price)[0],
            "relVolume": round(random.uniform(0.5, 3), 2),
        }
        stocks.append(stock)

    # Sort by ticker
    stocks.sort(key=lambda x: x["ticker"])

    return stocks


def format_stock_data(stocks):
    # Format as JavaScript array
    lines = []
    for stock in stocks:
        line = f'    {{ticker: "{stock["ticker"]}", company: "{stock["company"]}", sector: "{stock["sector"]}", industry: "{stock["industry"]}", country: "{stock["country"]}", exchange: "{stock["exchange"]}", index: "{stock["index"]}", marketCap: {stock["marketCap"]}, price: {stock["price"]}, change: {stock["change"]}, pe: {stock["pe"]}, volume: {stock["volume"]}, avgVolume: {stock["avgVolume"]}, dividendYield: {stock["dividendYield"]}, shortFloat: {stock["shortFloat"]}, analystRecom: {stock["analystRecom"]}, optionable: {str(stock["optionable"]).lower()}, shortable: {str(stock["shortable"]).lower()}, rsi: {stock["rsi"]}, beta: {stock["beta"]}, volatility: {stock["volatility"]}, high52w: {stock["high52w"]}, low52w: {stock["low52w"]}, relVolume: {stock["relVolume"]}}}'
        lines.append(line)

    return "const STOCKS_DATA = [\n" + ",\n".join(lines) + "\n];"


if __name__ == "__main__":
    print("Generating stock data...")
    stocks = generate_stocks(220)
    print(f"Generated {len(stocks)} stocks")

    # Show distribution
    sectors = {}
    for stock in stocks:
        sector = stock["sector"]
        sectors[sector] = sectors.get(sector, 0) + 1

    print("\nDistribution by sector:")
    for sector, count in sorted(sectors.items()):
        print(f"  {sector}: {count}")

    exchanges = {}
    for stock in stocks:
        ex = stock["exchange"]
        exchanges[ex] = exchanges.get(ex, 0) + 1

    print("\nDistribution by exchange:")
    for ex, count in sorted(exchanges.items()):
        print(f"  {ex}: {count}")

    indexes = {}
    for stock in stocks:
        idx = stock["index"] or "none"
        indexes[idx] = indexes.get(idx, 0) + 1

    print("\nDistribution by index:")
    for idx, count in sorted(indexes.items()):
        print(f"  {idx}: {count}")

    # Generate JavaScript code
    js_code = format_stock_data(stocks)

    # Write to file
    with open("/tmp/stocks_data.js", "w") as f:
        f.write(js_code)

    print(f"\nWrote JavaScript data to /tmp/stocks_data.js")
    print(f"File size: {len(js_code)} bytes")
