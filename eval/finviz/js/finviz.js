// Finviz Stock Screener Clone - JavaScript

// Stock data - embedded for pure frontend operation
const STOCKS_DATA = [
    {ticker: "AAPL", company: "Apple Inc", sector: "technology", industry: "Consumer Electronics", country: "usa", exchange: "nasd", index: "sp500", marketCap: 7161.0, price: 17.92, change: 0.69, pe: 111.6, volume: 48527, avgVolume: 53876, dividendYield: 0.84, shortFloat: 3.54, analystRecom: 3.2, optionable: true, shortable: true, rsi: 46.2, beta: 1.09, volatility: 2.5, high52w: 23.22, low52w: 14.98, relVolume: 0.84},
    {ticker: "AB", company: "Atlantic BioTech", sector: "consumer cyclical", industry: "Apparel Retail", country: "taiwan", exchange: "nasd", index: "nasdaq100", marketCap: 152.0, price: 19.56, change: -0.38, pe: 39.4, volume: 332, avgVolume: 606, dividendYield: 0.86, shortFloat: 2.81, analystRecom: 3.3, optionable: true, shortable: true, rsi: 35.6, beta: 0.95, volatility: 3.3, high52w: 28.31, low52w: 12.38, relVolume: 1.41},
    {ticker: "AB1", company: "American BioTech", sector: "industrials", industry: "Integrated Freight & Logistics", country: "china", exchange: "nasd", index: "djia", marketCap: 38.0, price: 12.6, change: -4.65, pe: 12.9, volume: 123, avgVolume: 275, dividendYield: 1.56, shortFloat: 2.24, analystRecom: 1.7, optionable: true, shortable: true, rsi: 28.0, beta: 2.23, volatility: 2.9, high52w: 14.66, low52w: 8.27, relVolume: 0.92},
    {ticker: "ABBV", company: "AbbVie Inc", sector: "healthcare", industry: "Drug Manufacturers - General", country: "usa", exchange: "nyse", index: "sp500", marketCap: 5777.0, price: 24.62, change: -0.04, pe: 68.1, volume: 28084, avgVolume: 52102, dividendYield: 1.57, shortFloat: 0.46, analystRecom: 2.2, optionable: true, shortable: true, rsi: 66.2, beta: 1.46, volatility: 0.5, high52w: 30.51, low52w: 19.28, relVolume: 1.69},
    {ticker: "AC", company: "Advanced Capital", sector: "technology", industry: "Information Technology Services", country: "taiwan", exchange: "nasd", index: "djia", marketCap: 6427.0, price: 8.44, change: 3.58, pe: 70.0, volume: 21097, avgVolume: 49415, dividendYield: 1.42, shortFloat: 4.52, analystRecom: 2.1, optionable: true, shortable: true, rsi: 73.7, beta: 1.97, volatility: 2.6, high52w: 11.04, low52w: 6.12, relVolume: 0.63},
    {ticker: "AC1", company: "Atlantic Capital", sector: "consumer cyclical", industry: "Apparel Retail", country: "germany", exchange: "cboe", index: "nasdaq100", marketCap: 3740.0, price: 47.08, change: 2.86, pe: 41.5, volume: 16707, avgVolume: 14229, dividendYield: 2.09, shortFloat: 2.37, analystRecom: 1.9, optionable: true, shortable: true, rsi: 53.3, beta: 0.64, volatility: 4.5, high52w: 59.66, low52w: 29.39, relVolume: 1.26},
    {ticker: "AC12", company: "American Capital", sector: "energy", industry: "Oil & Gas Equipment & Services", country: "taiwan", exchange: "amex", index: "", marketCap: 55504.0, price: 31.65, change: 1.83, pe: 5.6, volume: 153457, avgVolume: 374057, dividendYield: 2.17, shortFloat: 4.86, analystRecom: 3.3, optionable: true, shortable: true, rsi: 74.3, beta: 0.76, volatility: 4.3, high52w: 36.04, low52w: 21.13, relVolume: 1.2},
    {ticker: "AC3", company: "Apex Capital", sector: "industrials", industry: "Marine Shipping", country: "uk", exchange: "nyse", index: "nasdaq100", marketCap: 112882.0, price: 49.17, change: -1.4, pe: 49.7, volume: 548049, avgVolume: 323073, dividendYield: 0.83, shortFloat: 2.04, analystRecom: 2.2, optionable: false, shortable: true, rsi: 55.6, beta: 1.53, volatility: 4.7, high52w: 58.98, low52w: 30.99, relVolume: 2.58},
    {ticker: "AC34", company: "Apex Corporation", sector: "basic materials", industry: "Paper & Paper Products", country: "uk", exchange: "cboe", index: "sp500", marketCap: 3070.0, price: 0.5, change: 1.87, pe: 34.2, volume: 7217, avgVolume: 15298, dividendYield: 2.59, shortFloat: 3.42, analystRecom: 3.1, optionable: true, shortable: true, rsi: 26.4, beta: 1.76, volatility: 1.0, high52w: 0.7, low52w: 0.32, relVolume: 1.56},
    {ticker: "AC5", company: "Apex Capital", sector: "basic materials", industry: "Gold", country: "china", exchange: "cboe", index: "", marketCap: 25.0, price: 39.91, change: -3.32, pe: 32.7, volume: 101, avgVolume: 207, dividendYield: 1.85, shortFloat: 3.37, analystRecom: 2.8, optionable: true, shortable: true, rsi: 71.3, beta: 0.47, volatility: 0.8, high52w: 51.81, low52w: 30.5, relVolume: 2.22},
    {ticker: "ACN", company: "Accenture PLC Class A", sector: "technology", industry: "Information Technology Services", country: "usa", exchange: "nyse", index: "sp500", marketCap: 181.0, price: 0.5, change: 1.46, pe: 103.6, volume: 584, avgVolume: 346, dividendYield: 0.59, shortFloat: 1.73, analystRecom: 1.9, optionable: true, shortable: true, rsi: 65.0, beta: 1.4, volatility: 3.1, high52w: 0.71, low52w: 0.33, relVolume: 1.95},
    {ticker: "AD", company: "Apex Dynamics", sector: "consumer defensive", industry: "Beverages - Alcoholic", country: "china", exchange: "amex", index: "", marketCap: 7921.0, price: 6.2, change: -4.02, pe: 35.7, volume: 17902, avgVolume: 17126, dividendYield: 4.36, shortFloat: 0.8, analystRecom: 3.1, optionable: true, shortable: false, rsi: 29.3, beta: 0.66, volatility: 3.0, high52w: 8.58, low52w: 4.99, relVolume: 2.43},
    {ticker: "AD1", company: "Apex Dynamics", sector: "industrials", industry: "Integrated Freight & Logistics", country: "usa", exchange: "cboe", index: "sp500", marketCap: 3068.0, price: 23.55, change: -1.52, pe: 10.2, volume: 8782, avgVolume: 24987, dividendYield: 1.31, shortFloat: 3.49, analystRecom: 2.8, optionable: true, shortable: true, rsi: 32.5, beta: 0.68, volatility: 4.8, high52w: 26.55, low52w: 17.9, relVolume: 2.2},
    {ticker: "AD12", company: "Apex Dynamics", sector: "utilities", industry: "Utilities - Regulated Gas", country: "australia", exchange: "nyse", index: "russell2000", marketCap: 153.0, price: 0.5, change: -1.94, pe: 15.6, volume: 1162, avgVolume: 1052, dividendYield: 3.65, shortFloat: 4.1, analystRecom: 3.2, optionable: true, shortable: true, rsi: 72.5, beta: 2.29, volatility: 4.3, high52w: 0.61, low52w: 0.37, relVolume: 2.74},
    {ticker: "ADBE", company: "Adobe Inc", sector: "technology", industry: "Software - Application", country: "usa", exchange: "nasd", index: "sp500", marketCap: 7155.0, price: 4.5, change: -4.8, pe: 75.9, volume: 18874, avgVolume: 41324, dividendYield: 1.42, shortFloat: 1.14, analystRecom: 3.3, optionable: true, shortable: true, rsi: 34.4, beta: 0.56, volatility: 5.0, high52w: 4.97, low52w: 2.84, relVolume: 0.79},
    {ticker: "AE", company: "Atlantic Energy", sector: "real estate", industry: "REIT - Healthcare", country: "canada", exchange: "nyse", index: "russell2000", marketCap: 1279.0, price: 28.62, change: 0.59, pe: 15.7, volume: 6769, avgVolume: 3660, dividendYield: 0.2, shortFloat: 0.58, analystRecom: 3.0, optionable: true, shortable: true, rsi: 27.5, beta: 2.46, volatility: 4.6, high52w: 34.03, low52w: 17.2, relVolume: 0.58},
    {ticker: "AG", company: "Advanced Group", sector: "financial", industry: "Asset Management", country: "china", exchange: "nasd", index: "russell2000", marketCap: 1023.0, price: 19.22, change: 0.9, pe: 14.9, volume: 7206, avgVolume: 10083, dividendYield: 4.14, shortFloat: 3.6, analystRecom: 2.0, optionable: true, shortable: true, rsi: 68.2, beta: 1.37, volatility: 2.3, high52w: 22.39, low52w: 13.9, relVolume: 2.94},
    {ticker: "AG1", company: "Apex Group", sector: "utilities", industry: "Utilities - Regulated Water", country: "usa", exchange: "nyse", index: "russell2000", marketCap: 1934.0, price: 31.54, change: -4.17, pe: 21.5, volume: 11790, avgVolume: 10541, dividendYield: 4.09, shortFloat: 2.86, analystRecom: 3.3, optionable: true, shortable: false, rsi: 65.8, beta: 0.77, volatility: 1.1, high52w: 46.36, low52w: 22.3, relVolume: 0.95},
    {ticker: "AG12", company: "American Group", sector: "utilities", industry: "Utilities - Regulated Electric", country: "south korea", exchange: "nasd", index: "djia", marketCap: 999.0, price: 6.4, change: 1.71, pe: 23.2, volume: 5613, avgVolume: 7895, dividendYield: 5.99, shortFloat: 2.09, analystRecom: 2.0, optionable: false, shortable: true, rsi: 40.7, beta: 1.71, volatility: 2.6, high52w: 8.07, low52w: 4.09, relVolume: 1.9},
    {ticker: "AGL", company: "American Gaming Ltd", sector: "communication services", industry: "Entertainment", country: "canada", exchange: "cboe", index: "russell2000", marketCap: 2125799.0, price: 768.67, change: -4.4, pe: 16.9, volume: 5886409, avgVolume: 9696053, dividendYield: 0.82, shortFloat: 3.79, analystRecom: 2.4, optionable: true, shortable: true, rsi: 46.4, beta: 1.97, volatility: 2.8, high52w: 942.07, low52w: 481.7, relVolume: 1.34},
    {ticker: "AH", company: "Atlantic Holdings", sector: "financial", industry: "Capital Markets", country: "taiwan", exchange: "nasd", index: "djia", marketCap: 2665.0, price: 38.19, change: 3.47, pe: 12.5, volume: 6852, avgVolume: 8188, dividendYield: 5.02, shortFloat: 4.68, analystRecom: 2.9, optionable: false, shortable: true, rsi: 25.4, beta: 1.23, volatility: 2.2, high52w: 49.39, low52w: 27.23, relVolume: 1.83},
    {ticker: "AH1", company: "American Holdings", sector: "energy", industry: "Oil & Gas Equipment & Services", country: "taiwan", exchange: "nasd", index: "nasdaq100", marketCap: 845.0, price: 27.6, change: -3.36, pe: 11.9, volume: 1954, avgVolume: 8481, dividendYield: 1.24, shortFloat: 2.84, analystRecom: 2.9, optionable: true, shortable: false, rsi: 55.5, beta: 0.67, volatility: 2.5, high52w: 34.44, low52w: 20.92, relVolume: 2.38},
    {ticker: "AH12", company: "Apex Holdings", sector: "basic materials", industry: "Steel", country: "china", exchange: "nasd", index: "nasdaq100", marketCap: 25100.0, price: 36.05, change: 3.36, pe: 22.0, volume: 31327, avgVolume: 50759, dividendYield: 1.18, shortFloat: 1.08, analystRecom: 2.0, optionable: true, shortable: true, rsi: 51.3, beta: 0.53, volatility: 0.9, high52w: 50.17, low52w: 24.65, relVolume: 2.63},
    {ticker: "AI", company: "Atlantic Inc", sector: "technology", industry: "Communication Equipment", country: "japan", exchange: "amex", index: "sp500", marketCap: 910053.0, price: 519.29, change: 1.07, pe: 64.3, volume: 3819970, avgVolume: 1045800, dividendYield: 0.49, shortFloat: 1.54, analystRecom: 3.0, optionable: true, shortable: false, rsi: 64.8, beta: 1.16, volatility: 1.1, high52w: 737.82, low52w: 408.35, relVolume: 0.54},
    {ticker: "AI1", company: "Apex Industries", sector: "consumer defensive", industry: "Packaged Foods", country: "australia", exchange: "nasd", index: "djia", marketCap: 77.0, price: 0.5, change: -4.69, pe: 17.9, volume: 342, avgVolume: 241, dividendYield: 5.35, shortFloat: 1.0, analystRecom: 2.7, optionable: false, shortable: true, rsi: 33.8, beta: 1.96, volatility: 1.7, high52w: 0.64, low52w: 0.39, relVolume: 0.78},
    {ticker: "AI12", company: "American Inc", sector: "energy", industry: "Oil & Gas Midstream", country: "usa", exchange: "cboe", index: "", marketCap: 40451.0, price: 7.95, change: -0.93, pe: 9.5, volume: 353838, avgVolume: 133595, dividendYield: 4.06, shortFloat: 1.57, analystRecom: 3.3, optionable: false, shortable: true, rsi: 64.8, beta: 1.71, volatility: 3.7, high52w: 10.42, low52w: 6.54, relVolume: 1.3},
    {ticker: "AI3", company: "Advanced Inc", sector: "energy", industry: "Thermal Coal", country: "usa", exchange: "amex", index: "djia", marketCap: 149.0, price: 0.5, change: -2.78, pe: 16.6, volume: 675, avgVolume: 1062, dividendYield: 3.79, shortFloat: 1.9, analystRecom: 2.1, optionable: true, shortable: false, rsi: 40.0, beta: 1.58, volatility: 0.6, high52w: 0.56, low52w: 0.37, relVolume: 2.95},
    {ticker: "AI34", company: "Atlantic Industries", sector: "basic materials", industry: "Chemicals", country: "usa", exchange: "cboe", index: "djia", marketCap: 13.0, price: 43.63, change: -4.83, pe: 13.0, volume: 65, avgVolume: 111, dividendYield: 1.09, shortFloat: 0.62, analystRecom: 1.6, optionable: true, shortable: true, rsi: 39.7, beta: 0.95, volatility: 3.5, high52w: 64.45, low52w: 32.4, relVolume: 0.94},
    {ticker: "AI5", company: "Apex Inc", sector: "real estate", industry: "REIT - Residential", country: "usa", exchange: "nyse", index: "", marketCap: 1187.0, price: 39.32, change: 1.49, pe: 33.5, volume: 1930, avgVolume: 6245, dividendYield: 2.38, shortFloat: 4.17, analystRecom: 2.3, optionable: true, shortable: false, rsi: 31.7, beta: 0.55, volatility: 0.7, high52w: 50.08, low52w: 29.42, relVolume: 2.83},
    {ticker: "AL", company: "Atlantic Ltd", sector: "consumer cyclical", industry: "Internet Retail", country: "taiwan", exchange: "nasd", index: "", marketCap: 216.0, price: 34.42, change: -2.86, pe: 25.3, volume: 1162, avgVolume: 484, dividendYield: 1.31, shortFloat: 4.48, analystRecom: 3.4, optionable: true, shortable: true, rsi: 46.0, beta: 1.29, volatility: 3.7, high52w: 41.78, low52w: 22.59, relVolume: 0.83},
    {ticker: "AL1", company: "American Ltd", sector: "industrials", industry: "Farm & Heavy Construction Machinery", country: "germany", exchange: "amex", index: "", marketCap: 254.0, price: 0.5, change: 4.02, pe: 34.2, volume: 2474, avgVolume: 247, dividendYield: 0.18, shortFloat: 0.2, analystRecom: 3.0, optionable: true, shortable: false, rsi: 65.3, beta: 0.77, volatility: 2.2, high52w: 0.63, low52w: 0.35, relVolume: 0.92},
    {ticker: "AMD", company: "Advanced Micro Devices Inc", sector: "technology", industry: "Semiconductors", country: "usa", exchange: "nasd", index: "sp500", marketCap: 157.0, price: 34.22, change: -1.03, pe: 82.7, volume: 177, avgVolume: 1297, dividendYield: 0.09, shortFloat: 4.86, analystRecom: 3.0, optionable: true, shortable: true, rsi: 63.5, beta: 1.91, volatility: 2.4, high52w: 48.5, low52w: 27.98, relVolume: 1.01},
    {ticker: "AMG", company: "Atlantic Mobile Group", sector: "technology", industry: "Software - Application", country: "south korea", exchange: "nasd", index: "sp500", marketCap: 148.0, price: 38.07, change: 4.56, pe: 89.6, volume: 1104, avgVolume: 378, dividendYield: 0.69, shortFloat: 4.73, analystRecom: 3.1, optionable: true, shortable: true, rsi: 35.2, beta: 2.45, volatility: 4.5, high52w: 42.53, low52w: 28.87, relVolume: 1.27},
    {ticker: "AMZN", company: "Amazon.com Inc", sector: "consumer cyclical", industry: "Internet Retail", country: "usa", exchange: "nasd", index: "sp500", marketCap: 104.0, price: 45.23, change: 4.96, pe: 11.7, volume: 446, avgVolume: 911, dividendYield: 1.88, shortFloat: 1.13, analystRecom: 2.8, optionable: true, shortable: true, rsi: 48.8, beta: 2.36, volatility: 2.5, high52w: 60.3, low52w: 28.88, relVolume: 2.82},
    {ticker: "AP", company: "American Pharma", sector: "basic materials", industry: "Coking Coal", country: "usa", exchange: "nyse", index: "djia", marketCap: 372.0, price: 31.16, change: -0.4, pe: 41.5, volume: 555, avgVolume: 2046, dividendYield: 1.88, shortFloat: 0.23, analystRecom: 2.9, optionable: true, shortable: false, rsi: 65.1, beta: 0.77, volatility: 2.0, high52w: 41.5, low52w: 20.52, relVolume: 0.5},
    {ticker: "AP1", company: "American PLC", sector: "basic materials", industry: "Silver", country: "japan", exchange: "nyse", index: "nasdaq100", marketCap: 12.0, price: 49.4, change: -0.43, pe: 42.4, volume: 13, avgVolume: 32, dividendYield: 0.83, shortFloat: 2.65, analystRecom: 2.7, optionable: true, shortable: false, rsi: 44.5, beta: 1.84, volatility: 4.3, high52w: 56.05, low52w: 32.61, relVolume: 0.82},
    {ticker: "AP12", company: "Atlantic Partners", sector: "real estate", industry: "Real Estate - Development", country: "south korea", exchange: "cboe", index: "djia", marketCap: 1966979.0, price: 1247.99, change: -2.13, pe: 42.8, volume: 4386768, avgVolume: 3586892, dividendYield: 1.5, shortFloat: 4.3, analystRecom: 3.2, optionable: true, shortable: true, rsi: 53.4, beta: 2.41, volatility: 0.7, high52w: 1547.84, low52w: 789.11, relVolume: 1.94},
    {ticker: "AP3", company: "Atlantic Pharma", sector: "real estate", industry: "Real Estate - Development", country: "usa", exchange: "amex", index: "sp500", marketCap: 165768.0, price: 121.25, change: 2.64, pe: 19.3, volume: 870231, avgVolume: 1356094, dividendYield: 1.47, shortFloat: 3.52, analystRecom: 2.5, optionable: true, shortable: true, rsi: 71.8, beta: 2.2, volatility: 0.5, high52w: 168.85, low52w: 90.02, relVolume: 2.03},
    {ticker: "AP34", company: "Atlantic Partners", sector: "communication services", industry: "Broadcasting", country: "taiwan", exchange: "nasd", index: "djia", marketCap: 2231.0, price: 32.49, change: 2.59, pe: 11.6, volume: 3534, avgVolume: 4254, dividendYield: 1.14, shortFloat: 2.74, analystRecom: 2.9, optionable: true, shortable: true, rsi: 37.3, beta: 2.31, volatility: 2.0, high52w: 46.24, low52w: 21.36, relVolume: 2.24},
    {ticker: "AP5", company: "Apex PLC", sector: "utilities", industry: "Utilities - Regulated Gas", country: "china", exchange: "amex", index: "nasdaq100", marketCap: 195541.0, price: 119.4, change: -2.66, pe: 12.2, volume: 1835666, avgVolume: 1392825, dividendYield: 2.26, shortFloat: 1.69, analystRecom: 3.2, optionable: true, shortable: true, rsi: 72.4, beta: 0.9, volatility: 0.9, high52w: 139.92, low52w: 73.26, relVolume: 1.72},
    {ticker: "AP56", company: "Atlantic Partners", sector: "utilities", industry: "Utilities - Regulated Gas", country: "switzerland", exchange: "nyse", index: "russell2000", marketCap: 8824.0, price: 0.5, change: 3.86, pe: 19.5, volume: 72987, avgVolume: 56990, dividendYield: 3.44, shortFloat: 1.18, analystRecom: 3.1, optionable: true, shortable: false, rsi: 52.2, beta: 1.46, volatility: 4.8, high52w: 0.74, low52w: 0.34, relVolume: 1.47},
    {ticker: "AR", company: "Apex Resources", sector: "technology", industry: "Computer Hardware", country: "france", exchange: "cboe", index: "", marketCap: 13.0, price: 0.5, change: -4.13, pe: 117.6, volume: 32, avgVolume: 68, dividendYield: 0.4, shortFloat: 3.61, analystRecom: 3.1, optionable: true, shortable: true, rsi: 40.7, beta: 1.99, volatility: 0.8, high52w: 0.65, low52w: 0.33, relVolume: 1.03},
    {ticker: "AS", company: "Atlantic Systems", sector: "healthcare", industry: "Medical Care Facilities", country: "uk", exchange: "nasd", index: "russell2000", marketCap: 599.0, price: 12.2, change: 3.77, pe: 26.3, volume: 2791, avgVolume: 5054, dividendYield: 1.36, shortFloat: 2.8, analystRecom: 1.7, optionable: true, shortable: true, rsi: 59.8, beta: 1.37, volatility: 4.2, high52w: 16.12, low52w: 9.43, relVolume: 2.27},
    {ticker: "AS1", company: "Atlantic Systems", sector: "consumer cyclical", industry: "Residential Construction", country: "usa", exchange: "nasd", index: "sp500", marketCap: 231.0, price: 49.27, change: -1.6, pe: 14.2, volume: 1140, avgVolume: 2131, dividendYield: 2.53, shortFloat: 2.15, analystRecom: 2.9, optionable: true, shortable: false, rsi: 57.8, beta: 1.13, volatility: 2.3, high52w: 57.17, low52w: 30.62, relVolume: 1.95},
    {ticker: "AS12", company: "Advanced Systems", sector: "energy", industry: "Thermal Coal", country: "switzerland", exchange: "amex", index: "sp500", marketCap: 5010.0, price: 11.54, change: -2.54, pe: 16.9, volume: 28219, avgVolume: 18701, dividendYield: 1.96, shortFloat: 0.56, analystRecom: 1.7, optionable: true, shortable: false, rsi: 57.3, beta: 0.43, volatility: 4.5, high52w: 15.04, low52w: 7.62, relVolume: 0.84},
    {ticker: "AVGO", company: "Broadcom Inc", sector: "technology", industry: "Semiconductors", country: "usa", exchange: "nasd", index: "sp500", marketCap: 161483.0, price: 207.43, change: -4.67, pe: 34.1, volume: 1286554, avgVolume: 673493, dividendYield: 1.23, shortFloat: 4.7, analystRecom: 2.9, optionable: true, shortable: true, rsi: 73.0, beta: 1.48, volatility: 1.9, high52w: 252.4, low52w: 147.8, relVolume: 0.76},
    {ticker: "AWD", company: "American Web Dynamics", sector: "communication services", industry: "Internet Content & Information", country: "china", exchange: "cboe", index: "djia", marketCap: 28.0, price: 33.49, change: -4.87, pe: 20.8, volume: 56, avgVolume: 151, dividendYield: 0.82, shortFloat: 0.29, analystRecom: 3.4, optionable: true, shortable: false, rsi: 54.8, beta: 0.51, volatility: 4.4, high52w: 41.26, low52w: 24.37, relVolume: 0.57},
    {ticker: "AWS", company: "American Web Solutions", sector: "communication services", industry: "Internet Content & Information", country: "australia", exchange: "nyse", index: "djia", marketCap: 5753.0, price: 13.27, change: -1.83, pe: 43.8, volume: 52423, avgVolume: 31976, dividendYield: 1.45, shortFloat: 1.76, analystRecom: 2.8, optionable: false, shortable: true, rsi: 59.9, beta: 0.67, volatility: 2.2, high52w: 17.63, low52w: 11.21, relVolume: 1.54},
    {ticker: "BAC", company: "Bank of America Corp", sector: "financial", industry: "Banks - Diversified", country: "usa", exchange: "nyse", index: "sp500", marketCap: 170.0, price: 15.24, change: -0.4, pe: 9.0, volume: 1551, avgVolume: 710, dividendYield: 1.34, shortFloat: 3.42, analystRecom: 3.2, optionable: true, shortable: true, rsi: 42.8, beta: 0.41, volatility: 2.2, high52w: 19.53, low52w: 12.02, relVolume: 2.82},
    {ticker: "BRK.B", company: "Berkshire Hathaway Inc Class B", sector: "financial", industry: "Insurance - Diversified", country: "usa", exchange: "nyse", index: "sp500", marketCap: 63385.0, price: 38.32, change: 2.38, pe: 16.8, volume: 422921, avgVolume: 405624, dividendYield: 2.02, shortFloat: 3.72, analystRecom: 2.2, optionable: true, shortable: true, rsi: 66.6, beta: 1.29, volatility: 4.9, high52w: 46.98, low52w: 24.23, relVolume: 2.38},
    {ticker: "CB", company: "Continental BioTech", sector: "energy", industry: "Oil & Gas E&P", country: "uk", exchange: "nasd", index: "sp500", marketCap: 1849.0, price: 39.62, change: -4.37, pe: 15.5, volume: 17217, avgVolume: 6319, dividendYield: 4.79, shortFloat: 1.2, analystRecom: 2.4, optionable: false, shortable: true, rsi: 43.8, beta: 0.83, volatility: 2.8, high52w: 44.2, low52w: 33.66, relVolume: 2.65},
    {ticker: "CC", company: "Continental Capital", sector: "consumer cyclical", industry: "Travel Services", country: "usa", exchange: "cboe", index: "nasdaq100", marketCap: 2782.0, price: 35.65, change: -2.71, pe: 19.3, volume: 10587, avgVolume: 17249, dividendYield: 0.52, shortFloat: 1.87, analystRecom: 1.7, optionable: true, shortable: true, rsi: 69.0, beta: 2.47, volatility: 1.6, high52w: 47.5, low52w: 26.95, relVolume: 1.58},
    {ticker: "CCP", company: "Continental Cell PLC", sector: "healthcare", industry: "Biotechnology", country: "germany", exchange: "nasd", index: "djia", marketCap: 1340.0, price: 38.2, change: 2.16, pe: 36.9, volume: 7029, avgVolume: 3820, dividendYield: 0.62, shortFloat: 0.84, analystRecom: 1.6, optionable: true, shortable: false, rsi: 43.4, beta: 1.27, volatility: 4.6, high52w: 55.07, low52w: 24.88, relVolume: 1.05},
    {ticker: "CD", company: "Continental Dynamics", sector: "technology", industry: "Electronic Components", country: "china", exchange: "cboe", index: "sp500", marketCap: 492447.0, price: 255.63, change: 1.79, pe: 18.6, volume: 3670639, avgVolume: 1672275, dividendYield: 0.72, shortFloat: 4.7, analystRecom: 2.7, optionable: false, shortable: true, rsi: 29.1, beta: 1.91, volatility: 1.7, high52w: 359.83, low52w: 181.89, relVolume: 2.93},
    {ticker: "CL", company: "Continental Ltd", sector: "healthcare", industry: "Biotechnology", country: "india", exchange: "nyse", index: "nasdaq100", marketCap: 4551.0, price: 50.78, change: -2.06, pe: 40.9, volume: 17580, avgVolume: 36903, dividendYield: 2.85, shortFloat: 0.46, analystRecom: 2.4, optionable: true, shortable: false, rsi: 56.1, beta: 1.04, volatility: 3.6, high52w: 59.7, low52w: 34.64, relVolume: 0.94},
    {ticker: "CL1", company: "Continental Ltd", sector: "basic materials", industry: "Lumber & Wood Production", country: "japan", exchange: "nyse", index: "sp500", marketCap: 2501.0, price: 41.18, change: 0.19, pe: 35.5, volume: 21515, avgVolume: 20420, dividendYield: 0.18, shortFloat: 0.76, analystRecom: 3.2, optionable: true, shortable: true, rsi: 63.9, beta: 2.39, volatility: 2.1, high52w: 54.88, low52w: 28.09, relVolume: 1.37},
    {ticker: "CL12", company: "Continental Ltd", sector: "utilities", industry: "Utilities - Regulated Electric", country: "south korea", exchange: "amex", index: "nasdaq100", marketCap: 26.0, price: 30.4, change: -4.93, pe: 20.5, volume: 116, avgVolume: 89, dividendYield: 1.2, shortFloat: 1.21, analystRecom: 1.9, optionable: true, shortable: true, rsi: 36.3, beta: 1.28, volatility: 1.1, high52w: 41.63, low52w: 22.22, relVolume: 2.0},
    {ticker: "CMCSA", company: "Comcast Corporation Class A", sector: "communication services", industry: "Entertainment", country: "usa", exchange: "nasd", index: "sp500", marketCap: 2293992.0, price: 2000, change: -2.13, pe: 23.4, volume: 9510555, avgVolume: 6669247, dividendYield: 1.12, shortFloat: 1.62, analystRecom: 2.6, optionable: true, shortable: true, rsi: 67.9, beta: 1.92, volatility: 3.3, high52w: 2923.19, low52w: 1401.32, relVolume: 0.68},
    {ticker: "COST", company: "Costco Wholesale Corp", sector: "consumer defensive", industry: "Discount Stores", country: "usa", exchange: "nasd", index: "sp500", marketCap: 5998.0, price: 15.21, change: 0.64, pe: 16.0, volume: 12419, avgVolume: 45914, dividendYield: 1.82, shortFloat: 2.01, analystRecom: 2.6, optionable: true, shortable: true, rsi: 62.2, beta: 0.32, volatility: 4.5, high52w: 19.94, low52w: 12.87, relVolume: 2.72},
    {ticker: "CP", company: "Continental Partners", sector: "consumer defensive", industry: "Education & Training Services", country: "australia", exchange: "nasd", index: "djia", marketCap: 152931.0, price: 52.95, change: -3.66, pe: 29.0, volume: 1120532, avgVolume: 754223, dividendYield: 3.07, shortFloat: 0.74, analystRecom: 3.4, optionable: true, shortable: true, rsi: 50.4, beta: 0.82, volatility: 2.8, high52w: 70.41, low52w: 42.61, relVolume: 2.13},
    {ticker: "CRM", company: "Salesforce Inc", sector: "technology", industry: "Software - Application", country: "usa", exchange: "nyse", index: "sp500", marketCap: 2041591.0, price: 958.7, change: -3.78, pe: 42.7, volume: 4945165, avgVolume: 4707316, dividendYield: 0.74, shortFloat: 2.32, analystRecom: 2.3, optionable: true, shortable: true, rsi: 56.1, beta: 0.98, volatility: 1.3, high52w: 1281.19, low52w: 668.49, relVolume: 2.54},
    {ticker: "CS", company: "Continental Solutions", sector: "consumer cyclical", industry: "Travel Services", country: "canada", exchange: "nyse", index: "djia", marketCap: 818.0, price: 0.5, change: 4.32, pe: 31.2, volume: 5487, avgVolume: 3020, dividendYield: 1.51, shortFloat: 3.31, analystRecom: 2.6, optionable: true, shortable: true, rsi: 30.0, beta: 1.8, volatility: 1.1, high52w: 0.72, low52w: 0.35, relVolume: 0.71},
    {ticker: "CS1", company: "Continental Solutions", sector: "consumer defensive", industry: "Household & Personal Products", country: "france", exchange: "amex", index: "nasdaq100", marketCap: 37.0, price: 27.67, change: -2.51, pe: 40.9, volume: 228, avgVolume: 374, dividendYield: 2.44, shortFloat: 3.05, analystRecom: 3.2, optionable: true, shortable: false, rsi: 54.9, beta: 1.95, volatility: 1.2, high52w: 40.37, low52w: 17.41, relVolume: 0.68},
    {ticker: "CS12", company: "Continental Systems", sector: "communication services", industry: "Entertainment", country: "taiwan", exchange: "nyse", index: "sp500", marketCap: 8376.0, price: 34.29, change: 4.42, pe: 19.9, volume: 58577, avgVolume: 87905, dividendYield: 1.1, shortFloat: 1.1, analystRecom: 2.6, optionable: true, shortable: true, rsi: 44.0, beta: 0.99, volatility: 0.7, high52w: 46.27, low52w: 24.16, relVolume: 0.71},
    {ticker: "CSCO", company: "Cisco Systems Inc", sector: "technology", industry: "Communication Equipment", country: "usa", exchange: "nasd", index: "sp500", marketCap: 110760.0, price: 36.43, change: 0.43, pe: 91.3, volume: 279786, avgVolume: 526115, dividendYield: 0.12, shortFloat: 0.53, analystRecom: 2.0, optionable: true, shortable: true, rsi: 47.6, beta: 2.13, volatility: 0.6, high52w: 47.31, low52w: 23.46, relVolume: 1.15},
    {ticker: "CVX", company: "Chevron Corporation", sector: "energy", industry: "Oil & Gas Integrated", country: "usa", exchange: "nyse", index: "sp500", marketCap: 38.0, price: 0.5, change: 1.65, pe: 11.0, volume: 330, avgVolume: 51, dividendYield: 4.41, shortFloat: 3.51, analystRecom: 1.9, optionable: true, shortable: true, rsi: 63.7, beta: 0.74, volatility: 1.6, high52w: 0.57, low52w: 0.38, relVolume: 1.66},
    {ticker: "DB", company: "Dynamic BioTech", sector: "energy", industry: "Oil & Gas Equipment & Services", country: "germany", exchange: "nyse", index: "sp500", marketCap: 257.0, price: 26.73, change: 0.7, pe: 6.6, volume: 1278, avgVolume: 454, dividendYield: 4.92, shortFloat: 4.68, analystRecom: 2.3, optionable: true, shortable: true, rsi: 35.9, beta: 0.6, volatility: 1.3, high52w: 34.63, low52w: 20.8, relVolume: 1.81},
    {ticker: "DB1", company: "Dynamic BioTech", sector: "industrials", industry: "Marine Shipping", country: "india", exchange: "nasd", index: "djia", marketCap: 161279.0, price: 24.84, change: -1.63, pe: 11.4, volume: 773339, avgVolume: 1257170, dividendYield: 2.75, shortFloat: 2.38, analystRecom: 3.1, optionable: true, shortable: false, rsi: 45.3, beta: 1.02, volatility: 4.7, high52w: 37.03, low52w: 16.39, relVolume: 2.4},
    {ticker: "DC", company: "Dynamic Capital", sector: "financial", industry: "Financial Data & Stock Exchanges", country: "australia", exchange: "cboe", index: "russell2000", marketCap: 3186.0, price: 0.5, change: -1.78, pe: 13.1, volume: 21321, avgVolume: 9130, dividendYield: 1.16, shortFloat: 3.55, analystRecom: 3.1, optionable: true, shortable: true, rsi: 25.8, beta: 0.47, volatility: 2.7, high52w: 0.67, low52w: 0.31, relVolume: 2.65},
    {ticker: "DH", company: "Digital Holdings", sector: "basic materials", industry: "Other Precious Metals", country: "china", exchange: "nasd", index: "sp500", marketCap: 797.0, price: 0.5, change: 1.19, pe: 47.9, volume: 4855, avgVolume: 3866, dividendYield: 0.89, shortFloat: 1.22, analystRecom: 2.6, optionable: true, shortable: false, rsi: 63.7, beta: 0.77, volatility: 2.1, high52w: 0.71, low52w: 0.34, relVolume: 2.95},
    {ticker: "DIS", company: "Walt Disney Co", sector: "communication services", industry: "Entertainment", country: "usa", exchange: "nyse", index: "sp500", marketCap: 27294.0, price: 0.5, change: -2.41, pe: 46.9, volume: 94045, avgVolume: 273190, dividendYield: 0.17, shortFloat: 1.89, analystRecom: 3.2, optionable: true, shortable: true, rsi: 74.9, beta: 2.36, volatility: 0.5, high52w: 0.64, low52w: 0.42, relVolume: 1.36},
    {ticker: "DL", company: "Dynamic Ltd", sector: "real estate", industry: "REIT - Retail", country: "china", exchange: "cboe", index: "djia", marketCap: 129.0, price: 0.5, change: -3.52, pe: 26.2, volume: 1098, avgVolume: 298, dividendYield: 1.04, shortFloat: 4.15, analystRecom: 2.4, optionable: true, shortable: false, rsi: 45.1, beta: 0.8, volatility: 0.6, high52w: 0.7, low52w: 0.31, relVolume: 2.91},
    {ticker: "DL1", company: "Dynamic Ltd", sector: "communication services", industry: "Publishing", country: "usa", exchange: "nyse", index: "russell2000", marketCap: 139634.0, price: 102.6, change: 4.18, pe: 42.8, volume: 773024, avgVolume: 1554533, dividendYield: 0.79, shortFloat: 3.84, analystRecom: 1.7, optionable: true, shortable: false, rsi: 27.8, beta: 0.57, volatility: 0.9, high52w: 139.42, low52w: 66.07, relVolume: 1.86},
    {ticker: "DP", company: "Dynamic Partners", sector: "technology", industry: "Semiconductors", country: "india", exchange: "nasd", index: "nasdaq100", marketCap: 1389.0, price: 45.41, change: 4.77, pe: 49.0, volume: 7351, avgVolume: 9793, dividendYield: 0.04, shortFloat: 1.52, analystRecom: 2.5, optionable: true, shortable: false, rsi: 58.0, beta: 1.9, volatility: 1.6, high52w: 55.81, low52w: 30.65, relVolume: 1.17},
    {ticker: "DP1", company: "Digital PLC", sector: "real estate", industry: "Real Estate - Development", country: "china", exchange: "cboe", index: "nasdaq100", marketCap: 3083.0, price: 0.5, change: -4.25, pe: 49.3, volume: 8375, avgVolume: 5955, dividendYield: 2.17, shortFloat: 2.2, analystRecom: 2.6, optionable: true, shortable: true, rsi: 51.5, beta: 2.49, volatility: 4.9, high52w: 0.67, low52w: 0.37, relVolume: 2.7},
    {ticker: "DP12", company: "Digital PLC", sector: "communication services", industry: "Broadcasting", country: "canada", exchange: "amex", index: "russell2000", marketCap: 4502.0, price: 0.5, change: 3.01, pe: 20.6, volume: 29320, avgVolume: 16079, dividendYield: 1.43, shortFloat: 2.52, analystRecom: 2.5, optionable: true, shortable: true, rsi: 63.4, beta: 0.48, volatility: 4.3, high52w: 0.7, low52w: 0.34, relVolume: 0.97},
    {ticker: "DS", company: "Digital Solutions", sector: "financial", industry: "Banks - Diversified", country: "germany", exchange: "cboe", index: "nasdaq100", marketCap: 22.0, price: 26.1, change: 1.89, pe: 14.8, volume: 174, avgVolume: 161, dividendYield: 2.07, shortFloat: 1.54, analystRecom: 1.6, optionable: true, shortable: true, rsi: 70.3, beta: 1.47, volatility: 4.6, high52w: 35.29, low52w: 18.13, relVolume: 2.16},
    {ticker: "DS1", company: "Digital Solutions", sector: "consumer defensive", industry: "Beverages - Non-Alcoholic", country: "india", exchange: "amex", index: "sp500", marketCap: 818.0, price: 33.37, change: -4.56, pe: 11.3, volume: 2526, avgVolume: 5093, dividendYield: 2.09, shortFloat: 1.55, analystRecom: 2.6, optionable: true, shortable: false, rsi: 54.5, beta: 0.31, volatility: 0.9, high52w: 47.73, low52w: 21.21, relVolume: 2.14},
    {ticker: "DS12", company: "Dynamic Systems", sector: "real estate", industry: "REIT - Healthcare", country: "switzerland", exchange: "nasd", index: "sp500", marketCap: 1769.0, price: 41.36, change: -4.42, pe: 38.6, volume: 4307, avgVolume: 7671, dividendYield: 1.47, shortFloat: 2.87, analystRecom: 3.1, optionable: true, shortable: false, rsi: 49.5, beta: 1.41, volatility: 2.9, high52w: 60.7, low52w: 29.01, relVolume: 2.71},
    {ticker: "DS3", company: "Digital Systems", sector: "communication services", industry: "Telecom Services", country: "china", exchange: "nyse", index: "djia", marketCap: 1050.0, price: 0.5, change: 2.13, pe: 18.1, volume: 9363, avgVolume: 5582, dividendYield: 0.87, shortFloat: 1.33, analystRecom: 2.2, optionable: true, shortable: false, rsi: 42.6, beta: 0.9, volatility: 2.1, high52w: 0.58, low52w: 0.41, relVolume: 2.71},
    {ticker: "DS34", company: "Digital Systems", sector: "utilities", industry: "Utilities - Diversified", country: "uk", exchange: "cboe", index: "djia", marketCap: 1591.0, price: 2.66, change: 0.03, pe: 19.8, volume: 5153, avgVolume: 3603, dividendYield: 2.45, shortFloat: 2.03, analystRecom: 1.5, optionable: true, shortable: false, rsi: 72.2, beta: 1.0, volatility: 4.5, high52w: 3.94, low52w: 2.24, relVolume: 2.3},
    {ticker: "DS5", company: "Digital Systems", sector: "utilities", industry: "Utilities - Diversified", country: "switzerland", exchange: "amex", index: "sp500", marketCap: 8695.0, price: 3.53, change: 2.6, pe: 12.2, volume: 56816, avgVolume: 10185, dividendYield: 1.11, shortFloat: 3.41, analystRecom: 3.2, optionable: false, shortable: false, rsi: 52.1, beta: 1.0, volatility: 3.9, high52w: 5.26, low52w: 2.72, relVolume: 2.48},
    {ticker: "DSS", company: "Dynamic SaaS Systems", sector: "technology", industry: "Software - Application", country: "usa", exchange: "nasd", index: "sp500", marketCap: 199370.0, price: 61.37, change: 1.36, pe: 94.7, volume: 1553248, avgVolume: 2000655, dividendYield: 0.34, shortFloat: 0.13, analystRecom: 1.8, optionable: true, shortable: true, rsi: 35.1, beta: 0.95, volatility: 0.6, high52w: 82.52, low52w: 44.17, relVolume: 0.95},
    {ticker: "DT", company: "Dynamic Technologies", sector: "consumer defensive", industry: "Packaged Foods", country: "uk", exchange: "nyse", index: "", marketCap: 83350.0, price: 73.11, change: 2.18, pe: 30.4, volume: 143795, avgVolume: 419206, dividendYield: 2.17, shortFloat: 1.33, analystRecom: 2.9, optionable: true, shortable: true, rsi: 69.8, beta: 0.9, volatility: 1.3, high52w: 83.34, low52w: 44.09, relVolume: 2.38},
    {ticker: "FC", company: "First Corporation", sector: "consumer defensive", industry: "Tobacco", country: "china", exchange: "nasd", index: "djia", marketCap: 1810.0, price: 47.32, change: -0.05, pe: 49.1, volume: 4009, avgVolume: 3271, dividendYield: 5.46, shortFloat: 3.09, analystRecom: 2.1, optionable: true, shortable: false, rsi: 64.1, beta: 2.26, volatility: 0.7, high52w: 69.39, low52w: 34.83, relVolume: 0.82},
    {ticker: "FG", company: "First Group", sector: "technology", industry: "Consumer Electronics", country: "japan", exchange: "cboe", index: "djia", marketCap: 133674.0, price: 83.75, change: 4.42, pe: 90.7, volume: 937173, avgVolume: 1535138, dividendYield: 0.11, shortFloat: 1.33, analystRecom: 3.3, optionable: true, shortable: true, rsi: 48.6, beta: 0.68, volatility: 1.6, high52w: 113.37, low52w: 51.82, relVolume: 2.69},
    {ticker: "FG1", company: "First Group", sector: "financial", industry: "Insurance - Property & Casualty", country: "france", exchange: "cboe", index: "russell2000", marketCap: 112871.0, price: 15.26, change: -3.59, pe: 6.1, volume: 319955, avgVolume: 959146, dividendYield: 4.94, shortFloat: 2.54, analystRecom: 1.6, optionable: true, shortable: true, rsi: 59.8, beta: 1.87, volatility: 3.4, high52w: 21.95, low52w: 11.89, relVolume: 0.79},
    {ticker: "FG12", company: "First Group", sector: "financial", industry: "Insurance - Diversified", country: "usa", exchange: "nasd", index: "russell2000", marketCap: 137589.0, price: 107.53, change: 4.24, pe: 7.7, volume: 185991, avgVolume: 305278, dividendYield: 2.1, shortFloat: 1.65, analystRecom: 2.1, optionable: true, shortable: true, rsi: 58.2, beta: 0.72, volatility: 3.9, high52w: 143.83, low52w: 79.85, relVolume: 0.57},
    {ticker: "FG3", company: "First Group", sector: "basic materials", industry: "Chemicals", country: "usa", exchange: "nyse", index: "djia", marketCap: 44333.0, price: 41.71, change: -0.58, pe: 37.6, volume: 305217, avgVolume: 241671, dividendYield: 1.88, shortFloat: 2.7, analystRecom: 2.9, optionable: true, shortable: true, rsi: 30.0, beta: 1.5, volatility: 4.1, high52w: 51.05, low52w: 25.43, relVolume: 1.58},
    {ticker: "FH", company: "First Holdings", sector: "real estate", industry: "REIT - Industrial", country: "canada", exchange: "nyse", index: "russell2000", marketCap: 589.0, price: 0.5, change: -2.84, pe: 36.4, volume: 5496, avgVolume: 2451, dividendYield: 2.52, shortFloat: 4.6, analystRecom: 3.2, optionable: true, shortable: false, rsi: 54.2, beta: 1.37, volatility: 4.8, high52w: 0.74, low52w: 0.3, relVolume: 1.24},
    {ticker: "FI", company: "First Inc", sector: "utilities", industry: "Utilities - Regulated Water", country: "australia", exchange: "amex", index: "djia", marketCap: 1549824.0, price: 461.69, change: -0.5, pe: 18.0, volume: 12906591, avgVolume: 5791851, dividendYield: 1.13, shortFloat: 1.33, analystRecom: 2.5, optionable: true, shortable: true, rsi: 28.6, beta: 1.35, volatility: 3.2, high52w: 681.44, low52w: 317.8, relVolume: 2.41},
    {ticker: "FP", company: "First PLC", sector: "energy", industry: "Uranium", country: "usa", exchange: "nyse", index: "", marketCap: 136.0, price: 11.11, change: 0.63, pe: 11.5, volume: 815, avgVolume: 588, dividendYield: 5.36, shortFloat: 0.55, analystRecom: 2.4, optionable: true, shortable: true, rsi: 45.2, beta: 0.81, volatility: 3.1, high52w: 13.01, low52w: 7.6, relVolume: 2.94},
    {ticker: "FR", company: "First Resources", sector: "real estate", industry: "REIT - Industrial", country: "australia", exchange: "nyse", index: "djia", marketCap: 1471.0, price: 47.53, change: 2.36, pe: 14.3, volume: 4184, avgVolume: 16661, dividendYield: 0.26, shortFloat: 0.21, analystRecom: 2.9, optionable: true, shortable: true, rsi: 45.1, beta: 1.43, volatility: 3.2, high52w: 67.62, low52w: 32.58, relVolume: 1.79},
    {ticker: "FS", company: "First Systems", sector: "consumer defensive", industry: "Packaged Foods", country: "taiwan", exchange: "nyse", index: "", marketCap: 1760812.0, price: 1155.9, change: 1.84, pe: 48.0, volume: 10943846, avgVolume: 8212641, dividendYield: 3.59, shortFloat: 4.34, analystRecom: 1.9, optionable: true, shortable: true, rsi: 72.4, beta: 1.4, volatility: 4.2, high52w: 1338.02, low52w: 768.88, relVolume: 2.48},
    {ticker: "GAD", company: "Global Aviation Dynamics", sector: "industrials", industry: "Aerospace & Defense", country: "usa", exchange: "nasd", index: "", marketCap: 304.0, price: 19.48, change: -2.19, pe: 41.7, volume: 494, avgVolume: 1324, dividendYield: 1.23, shortFloat: 1.58, analystRecom: 3.1, optionable: true, shortable: true, rsi: 36.1, beta: 0.75, volatility: 0.6, high52w: 22.26, low52w: 15.9, relVolume: 0.72},
    {ticker: "GD", company: "Global Dynamics", sector: "energy", industry: "Thermal Coal", country: "usa", exchange: "cboe", index: "djia", marketCap: 1858.0, price: 10.76, change: 4.41, pe: 11.8, volume: 10329, avgVolume: 10393, dividendYield: 1.34, shortFloat: 0.32, analystRecom: 3.0, optionable: true, shortable: false, rsi: 57.9, beta: 1.17, volatility: 1.4, high52w: 15.09, low52w: 8.82, relVolume: 0.68},
    {ticker: "GD1", company: "Global Dynamics", sector: "real estate", industry: "REIT - Healthcare", country: "japan", exchange: "cboe", index: "sp500", marketCap: 5203.0, price: 21.84, change: 3.83, pe: 28.5, volume: 40802, avgVolume: 40844, dividendYield: 1.86, shortFloat: 2.68, analystRecom: 2.4, optionable: true, shortable: false, rsi: 33.5, beta: 1.3, volatility: 1.3, high52w: 29.98, low52w: 13.26, relVolume: 0.72},
    {ticker: "GE", company: "Global Energy", sector: "energy", industry: "Thermal Coal", country: "japan", exchange: "nyse", index: "russell2000", marketCap: 2754056.0, price: 2000, change: -1.36, pe: 12.2, volume: 17211444, avgVolume: 27232415, dividendYield: 5.62, shortFloat: 2.57, analystRecom: 2.3, optionable: false, shortable: false, rsi: 37.9, beta: 1.23, volatility: 4.1, high52w: 2960.55, low52w: 1216.36, relVolume: 0.79},
    {ticker: "GE1", company: "Global Energy", sector: "industrials", industry: "Trucking", country: "usa", exchange: "cboe", index: "russell2000", marketCap: 34.0, price: 0.5, change: -0.68, pe: 15.8, volume: 225, avgVolume: 325, dividendYield: 2.74, shortFloat: 0.19, analystRecom: 3.2, optionable: true, shortable: true, rsi: 72.0, beta: 0.72, volatility: 2.2, high52w: 0.74, low52w: 0.4, relVolume: 2.78},
    {ticker: "GG", company: "Global Group", sector: "technology", industry: "Software - Application", country: "france", exchange: "nasd", index: "djia", marketCap: 954935.0, price: 307.75, change: -2.97, pe: 37.7, volume: 1988996, avgVolume: 9776207, dividendYield: 1.01, shortFloat: 1.38, analystRecom: 2.6, optionable: false, shortable: true, rsi: 64.2, beta: 1.11, volatility: 1.8, high52w: 449.04, low52w: 187.56, relVolume: 2.75},
    {ticker: "GG1", company: "Global Group", sector: "consumer cyclical", industry: "Footwear & Accessories", country: "germany", exchange: "nyse", index: "nasdaq100", marketCap: 5038.0, price: 46.35, change: 0.51, pe: 16.6, volume: 36092, avgVolume: 23907, dividendYield: 0.87, shortFloat: 3.21, analystRecom: 3.4, optionable: true, shortable: true, rsi: 49.7, beta: 1.09, volatility: 2.4, high52w: 66.94, low52w: 37.43, relVolume: 1.2},
    {ticker: "GG12", company: "Global Group", sector: "industrials", industry: "Industrial Distribution", country: "china", exchange: "nyse", index: "russell2000", marketCap: 7153.0, price: 7.26, change: 0.7, pe: 21.0, volume: 35500, avgVolume: 60519, dividendYield: 1.9, shortFloat: 2.24, analystRecom: 2.4, optionable: true, shortable: true, rsi: 39.6, beta: 0.5, volatility: 1.9, high52w: 8.57, low52w: 6.16, relVolume: 2.12},
    {ticker: "GH", company: "Global Holdings", sector: "financial", industry: "Insurance - Diversified", country: "germany", exchange: "amex", index: "djia", marketCap: 35682.0, price: 36.47, change: -2.08, pe: 16.8, volume: 339726, avgVolume: 45845, dividendYield: 3.9, shortFloat: 0.78, analystRecom: 3.4, optionable: true, shortable: false, rsi: 33.5, beta: 1.72, volatility: 3.3, high52w: 41.87, low52w: 22.06, relVolume: 1.15},
    {ticker: "GH1", company: "Global Holdings", sector: "industrials", industry: "Airlines", country: "usa", exchange: "amex", index: "djia", marketCap: 183717.0, price: 106.35, change: 3.08, pe: 21.1, volume: 197104, avgVolume: 372165, dividendYield: 1.31, shortFloat: 2.51, analystRecom: 3.0, optionable: true, shortable: true, rsi: 43.3, beta: 2.48, volatility: 3.0, high52w: 128.42, low52w: 84.36, relVolume: 0.63},
    {ticker: "GMP", company: "Global Medicine Partners", sector: "healthcare", industry: "Drug Manufacturers - General", country: "uk", exchange: "nasd", index: "", marketCap: 3405.0, price: 0.5, change: -0.09, pe: 60.1, volume: 4701, avgVolume: 22528, dividendYield: 2.74, shortFloat: 3.05, analystRecom: 2.6, optionable: true, shortable: true, rsi: 28.6, beta: 0.9, volatility: 2.3, high52w: 0.63, low52w: 0.36, relVolume: 1.97},
    {ticker: "GOOGL", company: "Alphabet Inc Class A", sector: "communication services", industry: "Internet Content & Information", country: "usa", exchange: "nasd", index: "sp500", marketCap: 2375.0, price: 0.5, change: -3.63, pe: 32.1, volume: 4041, avgVolume: 14534, dividendYield: 1.44, shortFloat: 0.92, analystRecom: 2.0, optionable: true, shortable: true, rsi: 52.4, beta: 2.4, volatility: 3.0, high52w: 0.73, low52w: 0.33, relVolume: 1.07},
    {ticker: "GP", company: "Global PLC", sector: "financial", industry: "Financial Data & Stock Exchanges", country: "taiwan", exchange: "cboe", index: "djia", marketCap: 1766970.0, price: 1147.83, change: -4.59, pe: 11.8, volume: 2470875, avgVolume: 3311920, dividendYield: 3.59, shortFloat: 1.95, analystRecom: 2.2, optionable: true, shortable: false, rsi: 50.8, beta: 0.85, volatility: 4.2, high52w: 1618.42, low52w: 941.49, relVolume: 1.79},
    {ticker: "GS", company: "Global Solutions", sector: "real estate", industry: "Real Estate - Development", country: "taiwan", exchange: "nyse", index: "djia", marketCap: 108.0, price: 44.46, change: 2.44, pe: 40.2, volume: 1004, avgVolume: 1152, dividendYield: 1.48, shortFloat: 4.09, analystRecom: 2.3, optionable: true, shortable: false, rsi: 28.6, beta: 2.45, volatility: 1.2, high52w: 61.14, low52w: 32.43, relVolume: 1.32},
    {ticker: "GT", company: "Global Technologies", sector: "consumer defensive", industry: "Packaged Foods", country: "usa", exchange: "nyse", index: "sp500", marketCap: 2082842.0, price: 550.98, change: 3.36, pe: 17.7, volume: 8959492, avgVolume: 16849532, dividendYield: 5.98, shortFloat: 1.05, analystRecom: 2.1, optionable: false, shortable: false, rsi: 36.7, beta: 0.91, volatility: 4.4, high52w: 637.3, low52w: 390.7, relVolume: 1.91},
    {ticker: "HD", company: "Home Depot Inc", sector: "consumer cyclical", industry: "Home Improvement Retail", country: "usa", exchange: "nyse", index: "sp500", marketCap: 2731721.0, price: 2000, change: -2.24, pe: 12.2, volume: 25176184, avgVolume: 9723289, dividendYield: 0.67, shortFloat: 1.73, analystRecom: 2.6, optionable: true, shortable: true, rsi: 44.4, beta: 1.62, volatility: 4.1, high52w: 2992.21, low52w: 1245.12, relVolume: 1.12},
    {ticker: "IAC", company: "Innovative Aerospace Capital", sector: "industrials", industry: "Aerospace & Defense", country: "india", exchange: "nyse", index: "djia", marketCap: 6636.0, price: 7.62, change: -3.59, pe: 37.3, volume: 24222, avgVolume: 52185, dividendYield: 1.14, shortFloat: 4.18, analystRecom: 1.8, optionable: true, shortable: false, rsi: 40.4, beta: 0.85, volatility: 3.9, high52w: 10.01, low52w: 4.76, relVolume: 1.34},
    {ticker: "IC", company: "International Corporation", sector: "consumer defensive", industry: "Grocery Stores", country: "australia", exchange: "cboe", index: "sp500", marketCap: 463.0, price: 37.62, change: -3.77, pe: 50.0, volume: 4624, avgVolume: 4542, dividendYield: 2.25, shortFloat: 4.93, analystRecom: 1.7, optionable: true, shortable: false, rsi: 73.1, beta: 0.57, volatility: 0.9, high52w: 46.7, low52w: 31.63, relVolume: 1.85},
    {ticker: "ID", company: "Innovative Dynamics", sector: "healthcare", industry: "Biotechnology", country: "japan", exchange: "nyse", index: "nasdaq100", marketCap: 483.0, price: 0.5, change: 0.2, pe: 30.0, volume: 2048, avgVolume: 1291, dividendYield: 2.35, shortFloat: 1.25, analystRecom: 1.7, optionable: true, shortable: false, rsi: 45.4, beta: 2.34, volatility: 4.7, high52w: 0.69, low52w: 0.32, relVolume: 2.03},
    {ticker: "IG", company: "International Group", sector: "utilities", industry: "Utilities - Renewable", country: "usa", exchange: "nyse", index: "sp500", marketCap: 1341399.0, price: 733.83, change: 1.07, pe: 12.2, volume: 12892009, avgVolume: 13454019, dividendYield: 3.37, shortFloat: 2.46, analystRecom: 2.7, optionable: true, shortable: true, rsi: 68.7, beta: 2.1, volatility: 1.7, high52w: 955.14, low52w: 615.78, relVolume: 2.83},
    {ticker: "IH", company: "Innovative Holdings", sector: "communication services", industry: "Telecom Services", country: "australia", exchange: "amex", index: "", marketCap: 2983445.0, price: 811.74, change: -2.19, pe: 20.8, volume: 23174727, avgVolume: 14011961, dividendYield: 1.17, shortFloat: 4.11, analystRecom: 3.4, optionable: false, shortable: false, rsi: 27.2, beta: 1.81, volatility: 1.0, high52w: 1117.33, low52w: 688.87, relVolume: 2.65},
    {ticker: "II", company: "Innovative Industries", sector: "healthcare", industry: "Diagnostics & Research", country: "canada", exchange: "cboe", index: "nasdaq100", marketCap: 1102672.0, price: 526.57, change: -1.69, pe: 24.7, volume: 2757537, avgVolume: 4424514, dividendYield: 0.38, shortFloat: 0.14, analystRecom: 1.8, optionable: false, shortable: false, rsi: 68.7, beta: 1.5, volatility: 0.6, high52w: 644.57, low52w: 418.55, relVolume: 1.88},
    {ticker: "IL", company: "International Ltd", sector: "energy", industry: "Uranium", country: "usa", exchange: "cboe", index: "", marketCap: 1513519.0, price: 560.09, change: -1.15, pe: 13.6, volume: 3925524, avgVolume: 2681467, dividendYield: 4.3, shortFloat: 2.77, analystRecom: 2.0, optionable: true, shortable: false, rsi: 59.3, beta: 1.16, volatility: 1.9, high52w: 788.89, low52w: 426.94, relVolume: 1.4},
    {ticker: "INTC", company: "Intel Corporation", sector: "technology", industry: "Semiconductors", country: "usa", exchange: "nasd", index: "sp500", marketCap: 651.0, price: 0.5, change: 3.09, pe: 108.6, volume: 784, avgVolume: 3986, dividendYield: 0.55, shortFloat: 0.99, analystRecom: 2.5, optionable: true, shortable: true, rsi: 42.8, beta: 1.48, volatility: 3.3, high52w: 0.61, low52w: 0.34, relVolume: 1.85},
    {ticker: "IP", company: "International Pharma", sector: "consumer defensive", industry: "Education & Training Services", country: "usa", exchange: "nasd", index: "russell2000", marketCap: 1956130.0, price: 2000, change: -4.82, pe: 33.7, volume: 5964858, avgVolume: 18046368, dividendYield: 5.46, shortFloat: 2.03, analystRecom: 2.2, optionable: false, shortable: true, rsi: 72.8, beta: 2.09, volatility: 0.7, high52w: 2952.79, low52w: 1566.56, relVolume: 2.04},
    {ticker: "IP1", company: "Innovative Partners", sector: "real estate", industry: "REIT - Residential", country: "switzerland", exchange: "nasd", index: "nasdaq100", marketCap: 1153401.0, price: 290.44, change: -1.35, pe: 14.7, volume: 3838213, avgVolume: 5850326, dividendYield: 0.53, shortFloat: 1.03, analystRecom: 3.3, optionable: false, shortable: true, rsi: 72.0, beta: 2.04, volatility: 4.6, high52w: 343.79, low52w: 233.66, relVolume: 2.23},
    {ticker: "IP12", company: "International Partners", sector: "communication services", industry: "Internet Content & Information", country: "france", exchange: "cboe", index: "djia", marketCap: 145253.0, price: 43.34, change: 2.32, pe: 11.5, volume: 1390543, avgVolume: 431325, dividendYield: 0.66, shortFloat: 4.35, analystRecom: 2.3, optionable: true, shortable: true, rsi: 67.3, beta: 0.34, volatility: 4.3, high52w: 49.94, low52w: 30.47, relVolume: 1.3},
    {ticker: "IP3", company: "International PLC", sector: "communication services", industry: "Entertainment", country: "australia", exchange: "nasd", index: "russell2000", marketCap: 7280.0, price: 0.5, change: -0.88, pe: 34.2, volume: 44081, avgVolume: 22111, dividendYield: 0.81, shortFloat: 4.73, analystRecom: 3.2, optionable: true, shortable: false, rsi: 31.8, beta: 1.38, volatility: 1.0, high52w: 0.59, low52w: 0.42, relVolume: 1.85},
    {ticker: "IPS", company: "Innovative Pharma Solutions", sector: "healthcare", industry: "Drug Manufacturers - General", country: "australia", exchange: "cboe", index: "sp500", marketCap: 200.0, price: 32.38, change: 4.94, pe: 40.9, volume: 1479, avgVolume: 587, dividendYield: 1.24, shortFloat: 3.13, analystRecom: 3.2, optionable: false, shortable: true, rsi: 53.5, beta: 0.76, volatility: 0.7, high52w: 41.76, low52w: 24.7, relVolume: 2.65},
    {ticker: "IS", company: "Innovative Solutions", sector: "consumer cyclical", industry: "Residential Construction", country: "uk", exchange: "nyse", index: "nasdaq100", marketCap: 3033.0, price: 0.5, change: -0.22, pe: 46.5, volume: 28389, avgVolume: 4492, dividendYield: 0.37, shortFloat: 0.44, analystRecom: 3.3, optionable: true, shortable: false, rsi: 48.3, beta: 1.34, volatility: 4.2, high52w: 0.69, low52w: 0.33, relVolume: 2.67},
    {ticker: "JNJ", company: "Johnson & Johnson", sector: "healthcare", industry: "Drug Manufacturers - General", country: "usa", exchange: "nyse", index: "sp500", marketCap: 165.0, price: 28.14, change: -3.5, pe: 30.2, volume: 560, avgVolume: 303, dividendYield: 0.76, shortFloat: 3.55, analystRecom: 3.4, optionable: true, shortable: true, rsi: 61.4, beta: 0.6, volatility: 4.2, high52w: 38.81, low52w: 21.85, relVolume: 1.13},
    {ticker: "JPM", company: "JPMorgan Chase & Co", sector: "financial", industry: "Banks - Diversified", country: "usa", exchange: "nyse", index: "sp500", marketCap: 6453.0, price: 0.5, change: -3.36, pe: 17.0, volume: 57018, avgVolume: 35115, dividendYield: 5.93, shortFloat: 2.67, analystRecom: 2.3, optionable: true, shortable: true, rsi: 58.9, beta: 0.63, volatility: 4.7, high52w: 0.63, low52w: 0.39, relVolume: 2.48},
    {ticker: "KO", company: "Coca-Cola Co", sector: "consumer defensive", industry: "Beverages - Non-Alcoholic", country: "usa", exchange: "nyse", index: "sp500", marketCap: 7326.0, price: 28.65, change: -3.69, pe: 35.3, volume: 67449, avgVolume: 14349, dividendYield: 3.23, shortFloat: 2.96, analystRecom: 2.6, optionable: true, shortable: true, rsi: 67.8, beta: 2.32, volatility: 1.7, high52w: 32.32, low52w: 18.8, relVolume: 1.97},
    {ticker: "LLY", company: "Eli Lilly and Co", sector: "healthcare", industry: "Drug Manufacturers - General", country: "usa", exchange: "nyse", index: "sp500", marketCap: 211.0, price: 14.92, change: 2.56, pe: 34.9, volume: 422, avgVolume: 1863, dividendYield: 2.98, shortFloat: 1.57, analystRecom: 3.1, optionable: true, shortable: true, rsi: 48.9, beta: 2.35, volatility: 5.0, high52w: 18.79, low52w: 10.53, relVolume: 0.96},
    {ticker: "MA", company: "Mastercard Inc Class A", sector: "financial", industry: "Financial Data & Stock Exchanges", country: "usa", exchange: "nyse", index: "sp500", marketCap: 1518.0, price: 1.96, change: -4.11, pe: 18.5, volume: 5262, avgVolume: 6566, dividendYield: 4.58, shortFloat: 2.05, analystRecom: 3.0, optionable: true, shortable: true, rsi: 38.6, beta: 0.45, volatility: 4.9, high52w: 2.53, low52w: 1.47, relVolume: 2.59},
    {ticker: "META", company: "Meta Platforms Inc", sector: "communication services", industry: "Internet Content & Information", country: "usa", exchange: "nasd", index: "sp500", marketCap: 169.0, price: 0.5, change: 4.74, pe: 28.3, volume: 1246, avgVolume: 1361, dividendYield: 0.23, shortFloat: 3.59, analystRecom: 1.8, optionable: true, shortable: true, rsi: 58.7, beta: 0.54, volatility: 1.1, high52w: 0.6, low52w: 0.32, relVolume: 0.9},
    {ticker: "MRK", company: "Merck & Co Inc", sector: "healthcare", industry: "Drug Manufacturers - General", country: "usa", exchange: "nyse", index: "sp500", marketCap: 708.0, price: 16.01, change: 0.89, pe: 79.9, volume: 2505, avgVolume: 6217, dividendYield: 0.08, shortFloat: 4.03, analystRecom: 3.4, optionable: true, shortable: true, rsi: 54.0, beta: 0.55, volatility: 3.4, high52w: 23.34, low52w: 13.47, relVolume: 2.13},
    {ticker: "MSFT", company: "Microsoft Corporation", sector: "technology", industry: "Software - Infrastructure", country: "usa", exchange: "nasd", index: "sp500", marketCap: 6091.0, price: 0.5, change: -1.55, pe: 98.2, volume: 28186, avgVolume: 13553, dividendYield: 1.07, shortFloat: 1.99, analystRecom: 2.6, optionable: true, shortable: true, rsi: 43.5, beta: 1.09, volatility: 0.8, high52w: 0.67, low52w: 0.35, relVolume: 1.94},
    {ticker: "NAH", company: "National Aviation Holdings", sector: "industrials", industry: "Aerospace & Defense", country: "usa", exchange: "amex", index: "nasdaq100", marketCap: 61763.0, price: 10.03, change: -3.31, pe: 46.9, volume: 269813, avgVolume: 210763, dividendYield: 1.25, shortFloat: 1.18, analystRecom: 3.3, optionable: true, shortable: false, rsi: 33.4, beta: 1.05, volatility: 2.1, high52w: 11.53, low52w: 6.37, relVolume: 2.08},
    {ticker: "NC", company: "National Capital", sector: "consumer defensive", industry: "Grocery Stores", country: "china", exchange: "cboe", index: "sp500", marketCap: 9315.0, price: 9.95, change: 2.59, pe: 34.0, volume: 41739, avgVolume: 27650, dividendYield: 1.89, shortFloat: 0.53, analystRecom: 3.2, optionable: false, shortable: true, rsi: 64.6, beta: 1.62, volatility: 3.3, high52w: 13.49, low52w: 7.45, relVolume: 0.51},
    {ticker: "NC1", company: "National Capital", sector: "industrials", industry: "Integrated Freight & Logistics", country: "australia", exchange: "cboe", index: "sp500", marketCap: 1844860.0, price: 703.23, change: 4.5, pe: 42.1, volume: 16621141, avgVolume: 12280618, dividendYield: 1.09, shortFloat: 2.54, analystRecom: 3.4, optionable: true, shortable: true, rsi: 63.7, beta: 1.0, volatility: 4.0, high52w: 832.87, low52w: 535.63, relVolume: 1.24},
    {ticker: "NC12", company: "Nexus Corporation", sector: "utilities", industry: "Utilities - Regulated Electric", country: "canada", exchange: "cboe", index: "djia", marketCap: 2476505.0, price: 1439.13, change: -1.01, pe: 15.8, volume: 5832416, avgVolume: 21945723, dividendYield: 1.06, shortFloat: 0.21, analystRecom: 1.6, optionable: true, shortable: true, rsi: 45.4, beta: 0.66, volatility: 4.2, high52w: 1872.04, low52w: 1121.63, relVolume: 0.57},
    {ticker: "ND", company: "Nexus Dynamics", sector: "consumer defensive", industry: "Grocery Stores", country: "usa", exchange: "nyse", index: "", marketCap: 67233.0, price: 11.16, change: 1.79, pe: 33.9, volume: 549362, avgVolume: 359958, dividendYield: 3.88, shortFloat: 3.19, analystRecom: 2.9, optionable: false, shortable: true, rsi: 28.3, beta: 1.38, volatility: 2.1, high52w: 14.32, low52w: 7.75, relVolume: 2.55},
    {ticker: "ND1", company: "Nexus Dynamics", sector: "energy", industry: "Oil & Gas Equipment & Services", country: "canada", exchange: "nyse", index: "djia", marketCap: 8860.0, price: 17.89, change: -2.85, pe: 12.9, volume: 17751, avgVolume: 60068, dividendYield: 2.01, shortFloat: 4.02, analystRecom: 2.9, optionable: false, shortable: false, rsi: 40.3, beta: 1.08, volatility: 4.4, high52w: 25.64, low52w: 15.01, relVolume: 2.88},
    {ticker: "NE", company: "Nexus Energy", sector: "financial", industry: "Insurance - Life", country: "australia", exchange: "nasd", index: "djia", marketCap: 240.0, price: 37.83, change: 4.73, pe: 14.8, volume: 1328, avgVolume: 2052, dividendYield: 3.83, shortFloat: 3.5, analystRecom: 1.7, optionable: true, shortable: true, rsi: 39.9, beta: 0.79, volatility: 2.7, high52w: 54.58, low52w: 31.87, relVolume: 2.78},
    {ticker: "NE1", company: "National Energy", sector: "financial", industry: "Credit Services", country: "usa", exchange: "nasd", index: "nasdaq100", marketCap: 63.0, price: 0.5, change: -3.91, pe: 8.9, volume: 120, avgVolume: 530, dividendYield: 3.07, shortFloat: 1.5, analystRecom: 2.0, optionable: true, shortable: true, rsi: 43.0, beta: 0.45, volatility: 2.2, high52w: 0.59, low52w: 0.31, relVolume: 1.63},
    {ticker: "NE12", company: "Nexus Energy", sector: "communication services", industry: "Entertainment", country: "switzerland", exchange: "nyse", index: "sp500", marketCap: 46.0, price: 20.42, change: -3.26, pe: 14.2, volume: 185, avgVolume: 250, dividendYield: 0.88, shortFloat: 0.74, analystRecom: 2.1, optionable: true, shortable: false, rsi: 55.9, beta: 1.81, volatility: 4.7, high52w: 26.14, low52w: 12.49, relVolume: 2.35},
    {ticker: "NFLX", company: "Netflix Inc", sector: "communication services", industry: "Entertainment", country: "usa", exchange: "nasd", index: "sp500", marketCap: 18369.0, price: 0.5, change: 1.78, pe: 32.7, volume: 84324, avgVolume: 35632, dividendYield: 0.43, shortFloat: 2.92, analystRecom: 2.8, optionable: true, shortable: true, rsi: 70.1, beta: 2.21, volatility: 1.5, high52w: 0.7, low52w: 0.42, relVolume: 1.93},
    {ticker: "NFS", company: "National Financial Systems", sector: "financial", industry: "Banks - Diversified", country: "usa", exchange: "nyse", index: "russell2000", marketCap: 1750811.0, price: 726.95, change: -4.9, pe: 8.3, volume: 7421242, avgVolume: 5524998, dividendYield: 3.99, shortFloat: 0.41, analystRecom: 2.7, optionable: true, shortable: false, rsi: 50.1, beta: 1.32, volatility: 1.2, high52w: 980.51, low52w: 536.13, relVolume: 1.91},
    {ticker: "NH", company: "National Holdings", sector: "basic materials", industry: "Copper", country: "japan", exchange: "amex", index: "sp500", marketCap: 2498.0, price: 19.07, change: -0.23, pe: 30.4, volume: 13385, avgVolume: 22716, dividendYield: 0.43, shortFloat: 2.35, analystRecom: 1.9, optionable: true, shortable: true, rsi: 61.2, beta: 1.03, volatility: 2.0, high52w: 28.16, low52w: 13.18, relVolume: 0.66},
    {ticker: "NI", company: "Nexus Inc", sector: "technology", industry: "Information Technology Services", country: "usa", exchange: "cboe", index: "djia", marketCap: 747230.0, price: 246.41, change: -4.75, pe: 118.5, volume: 2590189, avgVolume: 5247961, dividendYield: 0.65, shortFloat: 0.31, analystRecom: 3.3, optionable: true, shortable: true, rsi: 35.2, beta: 0.83, volatility: 3.7, high52w: 347.83, low52w: 152.11, relVolume: 1.48},
    {ticker: "NI1", company: "National Industries", sector: "communication services", industry: "Broadcasting", country: "usa", exchange: "amex", index: "russell2000", marketCap: 2051300.0, price: 462.16, change: -1.3, pe: 16.2, volume: 8032291, avgVolume: 12485988, dividendYield: 0.36, shortFloat: 0.74, analystRecom: 2.5, optionable: true, shortable: false, rsi: 66.6, beta: 1.73, volatility: 0.6, high52w: 675.17, low52w: 317.35, relVolume: 1.09},
    {ticker: "NKE", company: "Nike Inc Class B", sector: "consumer cyclical", industry: "Footwear & Accessories", country: "usa", exchange: "nyse", index: "sp500", marketCap: 1651596.0, price: 329.71, change: -1.83, pe: 26.3, volume: 9132199, avgVolume: 17742431, dividendYield: 0.62, shortFloat: 2.14, analystRecom: 3.1, optionable: true, shortable: true, rsi: 27.8, beta: 1.44, volatility: 0.6, high52w: 377.02, low52w: 264.09, relVolume: 2.18},
    {ticker: "NL", company: "Nexus Ltd", sector: "consumer defensive", industry: "Grocery Stores", country: "canada", exchange: "nyse", index: "russell2000", marketCap: 265.0, price: 23.22, change: -4.02, pe: 48.7, volume: 1550, avgVolume: 338, dividendYield: 1.32, shortFloat: 3.77, analystRecom: 3.4, optionable: true, shortable: true, rsi: 30.5, beta: 0.84, volatility: 0.8, high52w: 33.88, low52w: 17.09, relVolume: 2.4},
    {ticker: "NMI", company: "Nexus Motors Inc", sector: "consumer cyclical", industry: "Auto Manufacturers", country: "france", exchange: "nasd", index: "djia", marketCap: 1086419.0, price: 320.24, change: 3.19, pe: 29.2, volume: 3346317, avgVolume: 9562289, dividendYield: 2.15, shortFloat: 2.26, analystRecom: 1.8, optionable: true, shortable: true, rsi: 69.1, beta: 1.41, volatility: 3.4, high52w: 445.03, low52w: 272.01, relVolume: 1.79},
    {ticker: "NP", company: "National PLC", sector: "consumer cyclical", industry: "Residential Construction", country: "india", exchange: "amex", index: "sp500", marketCap: 2962426.0, price: 836.11, change: -0.56, pe: 46.6, volume: 6946454, avgVolume: 30548037, dividendYield: 1.04, shortFloat: 4.54, analystRecom: 2.9, optionable: true, shortable: true, rsi: 60.9, beta: 1.99, volatility: 3.6, high52w: 947.72, low52w: 623.77, relVolume: 1.59},
    {ticker: "NR", company: "National Resources", sector: "consumer cyclical", industry: "Home Improvement Retail", country: "japan", exchange: "nyse", index: "nasdaq100", marketCap: 662.0, price: 41.27, change: -4.6, pe: 11.7, volume: 2989, avgVolume: 2774, dividendYield: 1.45, shortFloat: 4.41, analystRecom: 1.7, optionable: true, shortable: true, rsi: 42.4, beta: 1.24, volatility: 0.9, high52w: 50.42, low52w: 25.09, relVolume: 1.75},
    {ticker: "NS", company: "Nexus Solutions", sector: "industrials", industry: "Electrical Equipment & Parts", country: "canada", exchange: "amex", index: "russell2000", marketCap: 9360.0, price: 39.21, change: 1.89, pe: 35.6, volume: 41760, avgVolume: 23531, dividendYield: 2.85, shortFloat: 2.79, analystRecom: 2.6, optionable: false, shortable: true, rsi: 36.4, beta: 1.79, volatility: 4.3, high52w: 48.08, low52w: 29.6, relVolume: 0.64},
    {ticker: "NT", company: "Nexus Technologies", sector: "technology", industry: "Communication Equipment", country: "germany", exchange: "nyse", index: "sp500", marketCap: 21.0, price: 29.96, change: 0.33, pe: 46.7, volume: 88, avgVolume: 113, dividendYield: 0.63, shortFloat: 4.75, analystRecom: 1.8, optionable: true, shortable: true, rsi: 40.3, beta: 2.33, volatility: 2.2, high52w: 44.89, low52w: 23.54, relVolume: 2.02},
    {ticker: "NVDA", company: "NVIDIA Corporation", sector: "technology", industry: "Semiconductors", country: "usa", exchange: "nasd", index: "sp500", marketCap: 1731.0, price: 45.45, change: -4.36, pe: 119.5, volume: 9423, avgVolume: 13516, dividendYield: 0.41, shortFloat: 2.25, analystRecom: 3.2, optionable: true, shortable: true, rsi: 57.3, beta: 2.02, volatility: 4.1, high52w: 56.25, low52w: 36.04, relVolume: 2.47},
    {ticker: "ORCL", company: "Oracle Corporation", sector: "technology", industry: "Software - Infrastructure", country: "usa", exchange: "nyse", index: "sp500", marketCap: 85.0, price: 33.71, change: 0.44, pe: 64.8, volume: 773, avgVolume: 348, dividendYield: 0.64, shortFloat: 0.75, analystRecom: 1.7, optionable: true, shortable: true, rsi: 49.8, beta: 2.01, volatility: 1.0, high52w: 42.89, low52w: 23.16, relVolume: 0.56},
    {ticker: "PB", company: "Premier BioTech", sector: "technology", industry: "Information Technology Services", country: "usa", exchange: "nyse", index: "nasdaq100", marketCap: 105.0, price: 1.41, change: -1.21, pe: 62.2, volume: 582, avgVolume: 172, dividendYield: 0.38, shortFloat: 3.79, analystRecom: 3.0, optionable: true, shortable: true, rsi: 40.9, beta: 1.38, volatility: 0.6, high52w: 1.78, low52w: 0.92, relVolume: 2.31},
    {ticker: "PB1", company: "Pinnacle BioTech", sector: "consumer cyclical", industry: "Footwear & Accessories", country: "usa", exchange: "cboe", index: "sp500", marketCap: 162.0, price: 42.05, change: -4.2, pe: 37.9, volume: 786, avgVolume: 1230, dividendYield: 1.16, shortFloat: 3.16, analystRecom: 3.5, optionable: true, shortable: true, rsi: 31.7, beta: 2.46, volatility: 3.2, high52w: 55.39, low52w: 35.13, relVolume: 0.82},
    {ticker: "PBC", company: "Premier Bio Capital", sector: "healthcare", industry: "Biotechnology", country: "usa", exchange: "cboe", index: "sp500", marketCap: 51985.0, price: 70.49, change: -3.76, pe: 64.8, volume: 161351, avgVolume: 174279, dividendYield: 1.74, shortFloat: 0.74, analystRecom: 2.5, optionable: false, shortable: false, rsi: 36.9, beta: 2.3, volatility: 4.6, high52w: 83.18, low52w: 59.06, relVolume: 2.59},
    {ticker: "PC", company: "Pinnacle Capital", sector: "basic materials", industry: "Other Precious Metals", country: "usa", exchange: "cboe", index: "russell2000", marketCap: 1967.0, price: 28.1, change: -4.42, pe: 42.7, volume: 17694, avgVolume: 12263, dividendYield: 1.01, shortFloat: 2.18, analystRecom: 2.1, optionable: true, shortable: true, rsi: 60.2, beta: 1.9, volatility: 4.3, high52w: 38.25, low52w: 18.57, relVolume: 2.65},
    {ticker: "PC1", company: "Premier Capital", sector: "utilities", industry: "Utilities - Regulated Electric", country: "usa", exchange: "nasd", index: "djia", marketCap: 1595021.0, price: 466.31, change: -2.29, pe: 17.3, volume: 14625050, avgVolume: 5078968, dividendYield: 3.78, shortFloat: 0.76, analystRecom: 2.1, optionable: true, shortable: false, rsi: 51.4, beta: 0.63, volatility: 2.2, high52w: 643.7, low52w: 314.35, relVolume: 2.92},
    {ticker: "PD", company: "Pinnacle Dynamics", sector: "healthcare", industry: "Diagnostics & Research", country: "australia", exchange: "cboe", index: "djia", marketCap: 3710.0, price: 40.54, change: 4.06, pe: 78.4, volume: 11001, avgVolume: 17020, dividendYield: 0.79, shortFloat: 4.71, analystRecom: 2.1, optionable: false, shortable: true, rsi: 31.6, beta: 1.54, volatility: 1.2, high52w: 45.03, low52w: 32.08, relVolume: 2.47},
    {ticker: "PE", company: "Pinnacle Energy", sector: "technology", industry: "Electronic Components", country: "china", exchange: "nasd", index: "", marketCap: 2697174.0, price: 576.08, change: 2.85, pe: 30.6, volume: 14202459, avgVolume: 6251073, dividendYield: 0.53, shortFloat: 0.87, analystRecom: 2.2, optionable: true, shortable: false, rsi: 48.1, beta: 0.63, volatility: 1.1, high52w: 845.43, low52w: 396.25, relVolume: 1.91},
    {ticker: "PE1", company: "Premier Energy", sector: "healthcare", industry: "Medical Care Facilities", country: "uk", exchange: "nyse", index: "djia", marketCap: 38.0, price: 15.94, change: -3.83, pe: 46.3, volume: 94, avgVolume: 249, dividendYield: 1.97, shortFloat: 1.93, analystRecom: 3.2, optionable: true, shortable: true, rsi: 58.0, beta: 0.63, volatility: 1.2, high52w: 23.06, low52w: 9.79, relVolume: 2.42},
    {ticker: "PE12", company: "Premier Energy", sector: "energy", industry: "Thermal Coal", country: "uk", exchange: "cboe", index: "russell2000", marketCap: 105437.0, price: 102.99, change: -1.58, pe: 18.4, volume: 788362, avgVolume: 121403, dividendYield: 1.64, shortFloat: 3.33, analystRecom: 2.7, optionable: true, shortable: true, rsi: 57.0, beta: 1.03, volatility: 2.2, high52w: 128.79, low52w: 80.9, relVolume: 1.64},
    {ticker: "PE3", company: "Pacific Energy", sector: "energy", industry: "Oil & Gas Integrated", country: "japan", exchange: "nasd", index: "sp500", marketCap: 1811524.0, price: 1599.51, change: 0.28, pe: 6.1, volume: 18055137, avgVolume: 12602096, dividendYield: 1.02, shortFloat: 4.92, analystRecom: 2.7, optionable: true, shortable: false, rsi: 48.5, beta: 0.62, volatility: 2.3, high52w: 2324.15, low52w: 1189.14, relVolume: 1.31},
    {ticker: "PEP", company: "PepsiCo Inc", sector: "consumer defensive", industry: "Beverages - Non-Alcoholic", country: "usa", exchange: "nasd", index: "sp500", marketCap: 1753.0, price: 31.62, change: -2.61, pe: 27.4, volume: 1921, avgVolume: 11944, dividendYield: 5.27, shortFloat: 0.33, analystRecom: 1.7, optionable: true, shortable: true, rsi: 48.9, beta: 2.22, volatility: 4.4, high52w: 37.82, low52w: 22.6, relVolume: 0.85},
    {ticker: "PG", company: "Pinnacle Group", sector: "healthcare", industry: "Diagnostics & Research", country: "south korea", exchange: "cboe", index: "djia", marketCap: 8767.0, price: 49.1, change: 2.55, pe: 68.3, volume: 53413, avgVolume: 73885, dividendYield: 0.36, shortFloat: 4.72, analystRecom: 3.0, optionable: true, shortable: true, rsi: 51.6, beta: 2.11, volatility: 3.5, high52w: 56.99, low52w: 39.21, relVolume: 2.12},
    {ticker: "PG", company: "Procter & Gamble Co", sector: "consumer defensive", industry: "Household & Personal Products", country: "usa", exchange: "nyse", index: "sp500", marketCap: 1524.0, price: 0.5, change: 2.65, pe: 20.1, volume: 3161, avgVolume: 5275, dividendYield: 4.66, shortFloat: 3.9, analystRecom: 1.6, optionable: true, shortable: true, rsi: 46.1, beta: 0.43, volatility: 3.8, high52w: 0.6, low52w: 0.4, relVolume: 1.82},
    {ticker: "PGT", company: "Pacific Gas Technologies", sector: "energy", industry: "Oil & Gas Integrated", country: "australia", exchange: "nyse", index: "djia", marketCap: 2601669.0, price: 611.55, change: 3.38, pe: 6.9, volume: 25573838, avgVolume: 18896952, dividendYield: 5.22, shortFloat: 2.41, analystRecom: 2.0, optionable: true, shortable: true, rsi: 38.4, beta: 0.75, volatility: 4.8, high52w: 855.06, low52w: 493.34, relVolume: 0.94},
    {ticker: "PH", company: "Pinnacle Holdings", sector: "communication services", industry: "Telecom Services", country: "south korea", exchange: "nasd", index: "russell2000", marketCap: 7918.0, price: 30.57, change: 1.63, pe: 32.3, volume: 62207, avgVolume: 9130, dividendYield: 0.12, shortFloat: 1.62, analystRecom: 2.7, optionable: true, shortable: true, rsi: 65.5, beta: 1.02, volatility: 2.0, high52w: 38.34, low52w: 19.8, relVolume: 1.38},
    {ticker: "PI", company: "Premier Inc", sector: "industrials", industry: "Specialty Industrial Machinery", country: "china", exchange: "amex", index: "russell2000", marketCap: 47622.0, price: 59.38, change: -1.06, pe: 39.6, volume: 456409, avgVolume: 183444, dividendYield: 0.18, shortFloat: 1.39, analystRecom: 3.3, optionable: true, shortable: true, rsi: 40.2, beta: 1.22, volatility: 4.6, high52w: 85.59, low52w: 48.6, relVolume: 2.0},
    {ticker: "PI1", company: "Premier Industries", sector: "industrials", industry: "Aerospace & Defense", country: "japan", exchange: "nyse", index: "sp500", marketCap: 1434.0, price: 28.02, change: -2.12, pe: 34.0, volume: 14144, avgVolume: 9711, dividendYield: 1.85, shortFloat: 1.65, analystRecom: 2.1, optionable: true, shortable: true, rsi: 56.5, beta: 0.37, volatility: 3.9, high52w: 35.25, low52w: 20.21, relVolume: 1.38},
    {ticker: "PI12", company: "Pinnacle Inc", sector: "basic materials", industry: "Aluminum", country: "india", exchange: "nyse", index: "djia", marketCap: 2441.0, price: 0.5, change: 0.07, pe: 31.0, volume: 6938, avgVolume: 19027, dividendYield: 1.24, shortFloat: 1.23, analystRecom: 1.8, optionable: true, shortable: true, rsi: 51.6, beta: 0.73, volatility: 4.2, high52w: 0.58, low52w: 0.34, relVolume: 0.62},
    {ticker: "PI3", company: "Premier Inc", sector: "real estate", industry: "Real Estate - Development", country: "usa", exchange: "nyse", index: "", marketCap: 886.0, price: 50.64, change: 1.74, pe: 38.5, volume: 3945, avgVolume: 5220, dividendYield: 1.66, shortFloat: 1.59, analystRecom: 2.5, optionable: true, shortable: true, rsi: 59.1, beta: 1.92, volatility: 3.1, high52w: 75.63, low52w: 33.25, relVolume: 2.86},
    {ticker: "PL", company: "Pinnacle Ltd", sector: "consumer cyclical", industry: "Apparel Retail", country: "usa", exchange: "nyse", index: "", marketCap: 724.0, price: 0.5, change: 3.44, pe: 32.0, volume: 3902, avgVolume: 3617, dividendYield: 1.72, shortFloat: 4.73, analystRecom: 3.3, optionable: true, shortable: true, rsi: 73.9, beta: 0.89, volatility: 1.4, high52w: 0.58, low52w: 0.3, relVolume: 2.82},
    {ticker: "PL1", company: "Pacific Ltd", sector: "industrials", industry: "Specialty Industrial Machinery", country: "china", exchange: "cboe", index: "russell2000", marketCap: 252.0, price: 9.18, change: -3.48, pe: 14.7, volume: 941, avgVolume: 1329, dividendYield: 0.1, shortFloat: 1.71, analystRecom: 1.8, optionable: false, shortable: false, rsi: 55.2, beta: 1.06, volatility: 2.1, high52w: 13.29, low52w: 6.8, relVolume: 2.92},
    {ticker: "PL12", company: "Pacific Ltd", sector: "communication services", industry: "Telecom Services", country: "japan", exchange: "amex", index: "nasdaq100", marketCap: 123828.0, price: 72.53, change: -3.43, pe: 21.3, volume: 410050, avgVolume: 238345, dividendYield: 0.61, shortFloat: 1.61, analystRecom: 3.0, optionable: true, shortable: false, rsi: 44.7, beta: 0.67, volatility: 2.5, high52w: 105.8, low52w: 53.82, relVolume: 1.48},
    {ticker: "PP", company: "Premier PLC", sector: "technology", industry: "Communication Equipment", country: "usa", exchange: "nyse", index: "sp500", marketCap: 3464.0, price: 0.5, change: 0.99, pe: 76.9, volume: 13748, avgVolume: 12693, dividendYield: 1.11, shortFloat: 0.68, analystRecom: 2.0, optionable: true, shortable: false, rsi: 52.1, beta: 0.33, volatility: 4.8, high52w: 0.64, low52w: 0.31, relVolume: 0.66},
    {ticker: "PP1", company: "Premier Pharma", sector: "financial", industry: "Banks - Regional", country: "usa", exchange: "amex", index: "nasdaq100", marketCap: 3933.0, price: 0.5, change: -3.74, pe: 18.6, volume: 13090, avgVolume: 16848, dividendYield: 5.71, shortFloat: 2.8, analystRecom: 2.5, optionable: false, shortable: false, rsi: 42.4, beta: 1.25, volatility: 1.4, high52w: 0.58, low52w: 0.4, relVolume: 1.67},
    {ticker: "PP12", company: "Pinnacle Partners", sector: "consumer cyclical", industry: "Residential Construction", country: "taiwan", exchange: "amex", index: "djia", marketCap: 1695.0, price: 25.54, change: -2.37, pe: 13.7, volume: 11606, avgVolume: 12930, dividendYield: 2.65, shortFloat: 3.29, analystRecom: 2.7, optionable: true, shortable: true, rsi: 68.3, beta: 0.47, volatility: 1.3, high52w: 30.65, low52w: 19.49, relVolume: 2.06},
    {ticker: "PP3", company: "Premier PLC", sector: "consumer cyclical", industry: "Footwear & Accessories", country: "usa", exchange: "nyse", index: "", marketCap: 232090.0, price: 169.73, change: -4.06, pe: 22.6, volume: 1433910, avgVolume: 265187, dividendYield: 0.43, shortFloat: 2.52, analystRecom: 2.4, optionable: true, shortable: true, rsi: 67.1, beta: 1.28, volatility: 0.9, high52w: 213.7, low52w: 106.67, relVolume: 1.95},
    {ticker: "PP34", company: "Pacific Pharma", sector: "energy", industry: "Oil & Gas Midstream", country: "germany", exchange: "amex", index: "", marketCap: 1536.0, price: 31.54, change: -0.15, pe: 5.8, volume: 13229, avgVolume: 16626, dividendYield: 3.62, shortFloat: 2.04, analystRecom: 2.4, optionable: true, shortable: true, rsi: 46.4, beta: 1.06, volatility: 2.7, high52w: 39.17, low52w: 20.1, relVolume: 1.93},
    {ticker: "PR", company: "Pacific Resources", sector: "financial", industry: "Credit Services", country: "france", exchange: "nasd", index: "sp500", marketCap: 1759008.0, price: 1139.87, change: 0.92, pe: 14.8, volume: 5292122, avgVolume: 7999314, dividendYield: 4.52, shortFloat: 3.28, analystRecom: 3.2, optionable: true, shortable: true, rsi: 55.8, beta: 0.72, volatility: 4.5, high52w: 1498.45, low52w: 779.23, relVolume: 1.42},
    {ticker: "PR1", company: "Pacific Resources", sector: "financial", industry: "Insurance - Diversified", country: "usa", exchange: "nasd", index: "sp500", marketCap: 2661.0, price: 0.5, change: -3.41, pe: 6.7, volume: 20620, avgVolume: 20524, dividendYield: 3.39, shortFloat: 1.41, analystRecom: 2.4, optionable: true, shortable: true, rsi: 60.6, beta: 0.88, volatility: 2.2, high52w: 0.62, low52w: 0.33, relVolume: 2.85},
    {ticker: "PR12", company: "Pacific Resources", sector: "utilities", industry: "Utilities - Regulated Gas", country: "germany", exchange: "amex", index: "sp500", marketCap: 1288.0, price: 30.59, change: -3.02, pe: 12.8, volume: 12161, avgVolume: 2694, dividendYield: 4.37, shortFloat: 4.79, analystRecom: 2.5, optionable: true, shortable: false, rsi: 33.2, beta: 1.88, volatility: 1.8, high52w: 34.25, low52w: 22.56, relVolume: 0.51},
    {ticker: "PS", company: "Premier Systems", sector: "technology", industry: "Information Technology Services", country: "china", exchange: "nasd", index: "djia", marketCap: 6657.0, price: 42.48, change: 0.75, pe: 80.0, volume: 24228, avgVolume: 17712, dividendYield: 1.01, shortFloat: 4.36, analystRecom: 2.8, optionable: true, shortable: false, rsi: 30.6, beta: 1.37, volatility: 2.0, high52w: 63.15, low52w: 34.92, relVolume: 0.52},
    {ticker: "PS1", company: "Premier Systems", sector: "financial", industry: "Insurance - Property & Casualty", country: "switzerland", exchange: "nyse", index: "sp500", marketCap: 7429.0, price: 25.49, change: 2.08, pe: 9.6, volume: 33230, avgVolume: 34941, dividendYield: 2.24, shortFloat: 2.68, analystRecom: 1.8, optionable: true, shortable: false, rsi: 52.3, beta: 0.84, volatility: 2.7, high52w: 37.0, low52w: 17.05, relVolume: 1.64},
    {ticker: "PS12", company: "Pinnacle Solutions", sector: "financial", industry: "Insurance - Diversified", country: "canada", exchange: "nyse", index: "sp500", marketCap: 156442.0, price: 79.11, change: 1.82, pe: 10.9, volume: 562048, avgVolume: 247619, dividendYield: 5.93, shortFloat: 1.75, analystRecom: 1.7, optionable: false, shortable: true, rsi: 25.8, beta: 1.25, volatility: 1.7, high52w: 93.93, low52w: 53.83, relVolume: 2.27},
    {ticker: "PS3", company: "Premier Solutions", sector: "consumer defensive", industry: "Beverages - Alcoholic", country: "usa", exchange: "amex", index: "russell2000", marketCap: 30429.0, price: 62.01, change: 0.18, pe: 30.3, volume: 126782, avgVolume: 82632, dividendYield: 5.02, shortFloat: 3.29, analystRecom: 1.9, optionable: false, shortable: true, rsi: 65.3, beta: 2.23, volatility: 0.6, high52w: 73.79, low52w: 52.04, relVolume: 2.26},
    {ticker: "PS34", company: "Pacific Solutions", sector: "industrials", industry: "Specialty Industrial Machinery", country: "canada", exchange: "amex", index: "russell2000", marketCap: 1641.0, price: 0.5, change: 2.2, pe: 31.3, volume: 2000, avgVolume: 7943, dividendYield: 1.22, shortFloat: 1.13, analystRecom: 2.3, optionable: true, shortable: false, rsi: 51.2, beta: 0.8, volatility: 0.8, high52w: 0.61, low52w: 0.33, relVolume: 2.43},
    {ticker: "PS5", company: "Pinnacle Solutions", sector: "basic materials", industry: "Lumber & Wood Production", country: "japan", exchange: "cboe", index: "djia", marketCap: 1471107.0, price: 343.15, change: 0.39, pe: 14.9, volume: 6935530, avgVolume: 7851492, dividendYield: 1.25, shortFloat: 3.96, analystRecom: 1.8, optionable: true, shortable: false, rsi: 38.4, beta: 1.94, volatility: 4.5, high52w: 387.01, low52w: 265.41, relVolume: 0.55},
    {ticker: "PS56", company: "Pacific Systems", sector: "real estate", industry: "Real Estate Services", country: "uk", exchange: "nyse", index: "nasdaq100", marketCap: 297.0, price: 27.78, change: -0.11, pe: 40.5, volume: 1950, avgVolume: 647, dividendYield: 0.24, shortFloat: 4.03, analystRecom: 2.7, optionable: true, shortable: true, rsi: 52.0, beta: 0.75, volatility: 2.1, high52w: 30.9, low52w: 22.11, relVolume: 1.73},
    {ticker: "PS7", company: "Pacific Systems", sector: "utilities", industry: "Utilities - Regulated Electric", country: "uk", exchange: "cboe", index: "sp500", marketCap: 5736.0, price: 1.73, change: 4.2, pe: 18.5, volume: 25366, avgVolume: 24460, dividendYield: 5.58, shortFloat: 3.76, analystRecom: 2.1, optionable: true, shortable: true, rsi: 45.6, beta: 2.0, volatility: 4.7, high52w: 2.4, low52w: 1.18, relVolume: 1.45},
    {ticker: "PSS", company: "Premier SaaS Systems", sector: "technology", industry: "Software - Application", country: "germany", exchange: "cboe", index: "djia", marketCap: 190.0, price: 40.56, change: 0.12, pe: 53.4, volume: 840, avgVolume: 991, dividendYield: 0.07, shortFloat: 2.64, analystRecom: 2.5, optionable: true, shortable: true, rsi: 33.2, beta: 1.02, volatility: 1.3, high52w: 54.83, low52w: 33.86, relVolume: 1.61},
    {ticker: "PT", company: "Pacific Technologies", sector: "financial", industry: "Banks - Diversified", country: "uk", exchange: "amex", index: "sp500", marketCap: 38.0, price: 2.94, change: 4.15, pe: 9.2, volume: 301, avgVolume: 154, dividendYield: 4.07, shortFloat: 4.55, analystRecom: 1.9, optionable: true, shortable: true, rsi: 69.4, beta: 2.46, volatility: 2.5, high52w: 3.3, low52w: 2.17, relVolume: 2.46},
    {ticker: "PT1", company: "Pinnacle Technologies", sector: "consumer defensive", industry: "Household & Personal Products", country: "china", exchange: "nasd", index: "", marketCap: 6976.0, price: 40.69, change: 2.29, pe: 35.9, volume: 44116, avgVolume: 27793, dividendYield: 5.45, shortFloat: 1.13, analystRecom: 2.6, optionable: true, shortable: true, rsi: 39.6, beta: 1.3, volatility: 2.1, high52w: 50.24, low52w: 32.25, relVolume: 0.88},
    {ticker: "PT12", company: "Pacific Technologies", sector: "basic materials", industry: "Steel", country: "china", exchange: "nyse", index: "russell2000", marketCap: 5165.0, price: 38.19, change: -0.77, pe: 29.2, volume: 25476, avgVolume: 29019, dividendYield: 0.14, shortFloat: 1.21, analystRecom: 3.2, optionable: true, shortable: true, rsi: 66.4, beta: 1.2, volatility: 2.9, high52w: 52.7, low52w: 27.56, relVolume: 1.73},
    {ticker: "PWI", company: "Pacific Web Industries", sector: "communication services", industry: "Internet Content & Information", country: "usa", exchange: "cboe", index: "djia", marketCap: 148320.0, price: 69.66, change: 1.82, pe: 42.9, volume: 569299, avgVolume: 1339415, dividendYield: 1.46, shortFloat: 2.21, analystRecom: 2.0, optionable: true, shortable: true, rsi: 61.9, beta: 1.44, volatility: 3.7, high52w: 95.31, low52w: 53.38, relVolume: 1.66},
    {ticker: "QAD", company: "Quantum Auto Dynamics", sector: "consumer cyclical", industry: "Auto Manufacturers", country: "germany", exchange: "cboe", index: "", marketCap: 193847.0, price: 32.42, change: 3.92, pe: 47.8, volume: 1042285, avgVolume: 1226598, dividendYield: 1.29, shortFloat: 4.08, analystRecom: 2.2, optionable: true, shortable: true, rsi: 34.1, beta: 1.41, volatility: 2.5, high52w: 36.17, low52w: 24.05, relVolume: 1.26},
    {ticker: "QC", company: "Quantum Corporation", sector: "consumer defensive", industry: "Beverages - Non-Alcoholic", country: "taiwan", exchange: "amex", index: "", marketCap: 1223984.0, price: 397.22, change: 2.03, pe: 25.3, volume: 1846082, avgVolume: 3731694, dividendYield: 2.42, shortFloat: 4.03, analystRecom: 2.6, optionable: true, shortable: true, rsi: 29.9, beta: 2.44, volatility: 3.5, high52w: 462.06, low52w: 258.72, relVolume: 2.29},
    {ticker: "QD", company: "Quantum Dynamics", sector: "utilities", industry: "Utilities - Regulated Water", country: "china", exchange: "cboe", index: "", marketCap: 99648.0, price: 56.84, change: -1.42, pe: 15.8, volume: 406117, avgVolume: 330179, dividendYield: 5.16, shortFloat: 2.24, analystRecom: 1.5, optionable: true, shortable: false, rsi: 67.9, beta: 0.75, volatility: 1.5, high52w: 74.91, low52w: 44.87, relVolume: 2.62},
    {ticker: "QE", company: "Quantum Energy", sector: "technology", industry: "Electronic Components", country: "taiwan", exchange: "cboe", index: "", marketCap: 1348.0, price: 25.08, change: 2.48, pe: 71.4, volume: 3699, avgVolume: 13562, dividendYield: 0.3, shortFloat: 4.35, analystRecom: 2.2, optionable: true, shortable: true, rsi: 53.9, beta: 2.09, volatility: 4.9, high52w: 29.16, low52w: 17.47, relVolume: 2.67},
    {ticker: "QE1", company: "Quantum Energy", sector: "energy", industry: "Oil & Gas Equipment & Services", country: "australia", exchange: "nasd", index: "", marketCap: 13.0, price: 8.81, change: -2.06, pe: 12.1, volume: 56, avgVolume: 97, dividendYield: 5.0, shortFloat: 4.67, analystRecom: 1.7, optionable: true, shortable: true, rsi: 29.8, beta: 2.09, volatility: 1.7, high52w: 11.36, low52w: 6.45, relVolume: 0.91},
    {ticker: "QI", company: "Quantum Inc", sector: "healthcare", industry: "Medical Devices", country: "usa", exchange: "nyse", index: "nasdaq100", marketCap: 182403.0, price: 194.38, change: -2.51, pe: 53.8, volume: 1600131, avgVolume: 482963, dividendYield: 1.2, shortFloat: 4.62, analystRecom: 2.3, optionable: true, shortable: true, rsi: 55.3, beta: 1.49, volatility: 3.6, high52w: 230.81, low52w: 154.97, relVolume: 2.41},
    {ticker: "QI1", company: "Quantum Industries", sector: "basic materials", industry: "Silver", country: "germany", exchange: "nyse", index: "djia", marketCap: 105583.0, price: 86.46, change: -2.58, pe: 17.3, volume: 179286, avgVolume: 270641, dividendYield: 2.48, shortFloat: 3.23, analystRecom: 3.3, optionable: true, shortable: true, rsi: 38.4, beta: 2.18, volatility: 1.7, high52w: 96.53, low52w: 54.7, relVolume: 2.65},
    {ticker: "QI12", company: "Quantum Industries", sector: "real estate", industry: "REIT - Office", country: "switzerland", exchange: "nasd", index: "russell2000", marketCap: 1186.0, price: 0.5, change: -0.48, pe: 13.6, volume: 1958, avgVolume: 3530, dividendYield: 1.14, shortFloat: 3.55, analystRecom: 2.8, optionable: true, shortable: true, rsi: 71.3, beta: 0.77, volatility: 3.0, high52w: 0.6, low52w: 0.31, relVolume: 0.85},
    {ticker: "QIC", company: "Quantum Indemnity Capital", sector: "financial", industry: "Insurance - Diversified", country: "india", exchange: "amex", index: "djia", marketCap: 2022.0, price: 27.48, change: -0.22, pe: 14.0, volume: 13738, avgVolume: 11427, dividendYield: 2.03, shortFloat: 4.64, analystRecom: 2.6, optionable: true, shortable: false, rsi: 73.2, beta: 1.44, volatility: 3.9, high52w: 40.17, low52w: 19.59, relVolume: 2.22},
    {ticker: "QP", company: "Quantum Partners", sector: "healthcare", industry: "Drug Manufacturers - Specialty & Generic", country: "usa", exchange: "nasd", index: "", marketCap: 450.0, price: 4.82, change: -4.43, pe: 12.6, volume: 3608, avgVolume: 3236, dividendYield: 0.34, shortFloat: 1.35, analystRecom: 3.1, optionable: true, shortable: true, rsi: 51.9, beta: 1.78, volatility: 2.1, high52w: 7.0, low52w: 3.86, relVolume: 1.43},
    {ticker: "QP1", company: "Quantum Pharma", sector: "consumer cyclical", industry: "Home Improvement Retail", country: "south korea", exchange: "cboe", index: "djia", marketCap: 1136.0, price: 12.42, change: 4.74, pe: 18.1, volume: 8144, avgVolume: 1787, dividendYield: 1.54, shortFloat: 4.2, analystRecom: 3.1, optionable: true, shortable: true, rsi: 48.9, beta: 1.21, volatility: 1.7, high52w: 15.32, low52w: 7.6, relVolume: 2.79},
    {ticker: "QP12", company: "Quantum Pharma", sector: "basic materials", industry: "Steel", country: "germany", exchange: "amex", index: "russell2000", marketCap: 35673.0, price: 48.58, change: 2.49, pe: 34.2, volume: 81379, avgVolume: 254140, dividendYield: 2.72, shortFloat: 3.07, analystRecom: 2.4, optionable: true, shortable: true, rsi: 35.7, beta: 0.43, volatility: 2.6, high52w: 71.83, low52w: 34.21, relVolume: 0.67},
    {ticker: "QP3", company: "Quantum Partners", sector: "communication services", industry: "Entertainment", country: "south korea", exchange: "amex", index: "russell2000", marketCap: 110.0, price: 19.57, change: -2.98, pe: 46.4, volume: 872, avgVolume: 596, dividendYield: 0.05, shortFloat: 1.35, analystRecom: 2.5, optionable: true, shortable: true, rsi: 49.2, beta: 0.39, volatility: 1.7, high52w: 25.67, low52w: 13.6, relVolume: 1.78},
    {ticker: "SAH", company: "Summit Aerospace Holdings", sector: "industrials", industry: "Aerospace & Defense", country: "usa", exchange: "nasd", index: "sp500", marketCap: 263.0, price: 37.0, change: -4.54, pe: 36.0, volume: 473, avgVolume: 476, dividendYield: 0.1, shortFloat: 3.62, analystRecom: 1.7, optionable: true, shortable: true, rsi: 39.7, beta: 0.43, volatility: 4.8, high52w: 48.46, low52w: 26.14, relVolume: 2.41},
    {ticker: "SB", company: "Strategic BioTech", sector: "consumer defensive", industry: "Discount Stores", country: "usa", exchange: "cboe", index: "nasdaq100", marketCap: 82.0, price: 41.12, change: 2.82, pe: 19.5, volume: 759, avgVolume: 559, dividendYield: 1.43, shortFloat: 3.47, analystRecom: 2.5, optionable: true, shortable: true, rsi: 35.4, beta: 1.02, volatility: 2.7, high52w: 50.72, low52w: 34.71, relVolume: 2.05},
    {ticker: "SB1", company: "Strategic BioTech", sector: "industrials", industry: "Integrated Freight & Logistics", country: "australia", exchange: "nasd", index: "nasdaq100", marketCap: 1540655.0, price: 707.68, change: 0.45, pe: 34.8, volume: 14508901, avgVolume: 5659876, dividendYield: 2.94, shortFloat: 2.96, analystRecom: 2.8, optionable: false, shortable: false, rsi: 25.3, beta: 2.35, volatility: 2.1, high52w: 975.65, low52w: 499.23, relVolume: 0.7},
    {ticker: "SB12", company: "Sterling BioTech", sector: "real estate", industry: "REIT - Office", country: "south korea", exchange: "amex", index: "sp500", marketCap: 37674.0, price: 25.3, change: -2.99, pe: 25.3, volume: 161187, avgVolume: 381593, dividendYield: 3.0, shortFloat: 1.0, analystRecom: 2.4, optionable: true, shortable: true, rsi: 66.0, beta: 1.55, volatility: 2.2, high52w: 29.16, low52w: 19.46, relVolume: 1.62},
    {ticker: "SC", company: "Strategic Corporation", sector: "technology", industry: "Information Technology Services", country: "india", exchange: "amex", index: "russell2000", marketCap: 1410.0, price: 31.95, change: 2.25, pe: 31.2, volume: 4814, avgVolume: 2858, dividendYield: 1.5, shortFloat: 2.68, analystRecom: 3.1, optionable: true, shortable: true, rsi: 40.8, beta: 1.89, volatility: 4.6, high52w: 47.84, low52w: 19.35, relVolume: 1.39},
    {ticker: "SC1", company: "Strategic Corporation", sector: "real estate", industry: "REIT - Industrial", country: "uk", exchange: "cboe", index: "sp500", marketCap: 46219.0, price: 27.33, change: -1.96, pe: 45.5, volume: 319203, avgVolume: 70102, dividendYield: 2.86, shortFloat: 1.56, analystRecom: 2.0, optionable: true, shortable: true, rsi: 71.3, beta: 0.32, volatility: 4.5, high52w: 30.25, low52w: 20.27, relVolume: 2.95},
    {ticker: "SC12", company: "Sterling Corporation", sector: "utilities", industry: "Utilities - Diversified", country: "japan", exchange: "cboe", index: "sp500", marketCap: 489.0, price: 0.5, change: 4.73, pe: 23.2, volume: 2301, avgVolume: 1318, dividendYield: 1.28, shortFloat: 3.92, analystRecom: 2.0, optionable: false, shortable: false, rsi: 31.2, beta: 1.72, volatility: 4.3, high52w: 0.64, low52w: 0.33, relVolume: 1.4},
    {ticker: "SCE", company: "Sterling Chip Energy", sector: "technology", industry: "Semiconductors", country: "uk", exchange: "cboe", index: "nasdaq100", marketCap: 187489.0, price: 215.06, change: -0.49, pe: 69.3, volume: 317090, avgVolume: 2178906, dividendYield: 1.29, shortFloat: 1.42, analystRecom: 3.1, optionable: true, shortable: true, rsi: 53.0, beta: 0.35, volatility: 1.0, high52w: 310.48, low52w: 162.13, relVolume: 1.86},
    {ticker: "SE", company: "Strategic Energy", sector: "consumer cyclical", industry: "Apparel Retail", country: "china", exchange: "nasd", index: "djia", marketCap: 7341.0, price: 44.04, change: -4.65, pe: 29.8, volume: 14664, avgVolume: 58284, dividendYield: 1.44, shortFloat: 4.74, analystRecom: 3.1, optionable: true, shortable: false, rsi: 38.1, beta: 1.74, volatility: 0.6, high52w: 48.86, low52w: 32.04, relVolume: 0.62},
    {ticker: "SE1", company: "Strategic Energy", sector: "basic materials", industry: "Gold", country: "china", exchange: "cboe", index: "russell2000", marketCap: 18.0, price: 16.09, change: 0.6, pe: 30.9, volume: 22, avgVolume: 34, dividendYield: 0.6, shortFloat: 4.78, analystRecom: 2.5, optionable: false, shortable: true, rsi: 28.5, beta: 1.91, volatility: 2.9, high52w: 19.81, low52w: 10.06, relVolume: 2.36},
    {ticker: "SG", company: "Strategic Group", sector: "communication services", industry: "Entertainment", country: "canada", exchange: "amex", index: "djia", marketCap: 1590854.0, price: 336.66, change: 3.47, pe: 35.4, volume: 13566528, avgVolume: 10519666, dividendYield: 0.49, shortFloat: 4.09, analystRecom: 3.3, optionable: false, shortable: true, rsi: 68.2, beta: 2.01, volatility: 4.0, high52w: 398.61, low52w: 258.13, relVolume: 0.57},
    {ticker: "SH", company: "Summit Holdings", sector: "basic materials", industry: "Coking Coal", country: "japan", exchange: "nasd", index: "sp500", marketCap: 3855.0, price: 42.72, change: 4.44, pe: 41.1, volume: 35198, avgVolume: 27096, dividendYield: 1.27, shortFloat: 2.64, analystRecom: 1.5, optionable: false, shortable: false, rsi: 42.7, beta: 1.15, volatility: 2.9, high52w: 53.67, low52w: 30.8, relVolume: 1.25},
    {ticker: "SI", company: "Sterling Industries", sector: "financial", industry: "Banks - Diversified", country: "usa", exchange: "nyse", index: "russell2000", marketCap: 178236.0, price: 93.54, change: -1.03, pe: 14.1, volume: 784390, avgVolume: 1607985, dividendYield: 1.75, shortFloat: 2.74, analystRecom: 3.0, optionable: true, shortable: false, rsi: 51.1, beta: 1.84, volatility: 4.3, high52w: 115.67, low52w: 58.17, relVolume: 1.44},
    {ticker: "SI1", company: "Sterling Inc", sector: "consumer cyclical", industry: "Travel Services", country: "south korea", exchange: "cboe", index: "nasdaq100", marketCap: 5925.0, price: 34.17, change: 2.32, pe: 20.2, volume: 49279, avgVolume: 41494, dividendYield: 1.72, shortFloat: 1.53, analystRecom: 1.8, optionable: true, shortable: true, rsi: 27.3, beta: 0.73, volatility: 2.8, high52w: 50.45, low52w: 22.86, relVolume: 1.3},
    {ticker: "SI12", company: "Summit Industries", sector: "real estate", industry: "Real Estate Services", country: "japan", exchange: "nasd", index: "djia", marketCap: 255.0, price: 36.04, change: 0.61, pe: 29.4, volume: 1691, avgVolume: 467, dividendYield: 2.86, shortFloat: 3.82, analystRecom: 2.7, optionable: true, shortable: false, rsi: 31.9, beta: 0.52, volatility: 3.9, high52w: 43.58, low52w: 25.98, relVolume: 1.95},
    {ticker: "SL", company: "Sterling Ltd", sector: "healthcare", industry: "Healthcare Plans", country: "canada", exchange: "amex", index: "djia", marketCap: 85302.0, price: 1.89, change: -3.42, pe: 50.1, volume: 425389, avgVolume: 565145, dividendYield: 2.46, shortFloat: 0.3, analystRecom: 3.3, optionable: true, shortable: false, rsi: 64.2, beta: 1.86, volatility: 3.1, high52w: 2.38, low52w: 1.39, relVolume: 1.63},
    {ticker: "SL1", company: "Strategic Ltd", sector: "industrials", industry: "Electrical Equipment & Parts", country: "japan", exchange: "nyse", index: "djia", marketCap: 183917.0, price: 183.21, change: 3.7, pe: 48.9, volume: 1447974, avgVolume: 356317, dividendYield: 1.4, shortFloat: 0.61, analystRecom: 1.8, optionable: false, shortable: true, rsi: 61.0, beta: 0.59, volatility: 2.7, high52w: 216.48, low52w: 131.47, relVolume: 1.23},
    {ticker: "SNS", company: "Sterling Net Systems", sector: "communication services", industry: "Internet Content & Information", country: "canada", exchange: "cboe", index: "", marketCap: 95292.0, price: 73.96, change: -0.04, pe: 36.1, volume: 262954, avgVolume: 445703, dividendYield: 0.85, shortFloat: 2.72, analystRecom: 2.6, optionable: true, shortable: false, rsi: 32.7, beta: 1.52, volatility: 3.6, high52w: 109.16, low52w: 56.22, relVolume: 0.91},
    {ticker: "SOG", company: "Summit Oil Group", sector: "energy", industry: "Oil & Gas Integrated", country: "usa", exchange: "amex", index: "nasdaq100", marketCap: 500.0, price: 16.31, change: -2.12, pe: 12.9, volume: 4076, avgVolume: 2966, dividendYield: 2.8, shortFloat: 4.49, analystRecom: 2.6, optionable: true, shortable: true, rsi: 42.7, beta: 1.85, volatility: 3.5, high52w: 21.09, low52w: 10.36, relVolume: 1.54},
    {ticker: "SP", company: "Strategic Pharma", sector: "healthcare", industry: "Drug Manufacturers - Specialty & Generic", country: "switzerland", exchange: "cboe", index: "russell2000", marketCap: 284.0, price: 0.5, change: -3.03, pe: 49.0, volume: 848, avgVolume: 2247, dividendYield: 0.21, shortFloat: 2.37, analystRecom: 2.1, optionable: false, shortable: true, rsi: 74.6, beta: 1.5, volatility: 0.7, high52w: 0.64, low52w: 0.33, relVolume: 1.04},
    {ticker: "SP1", company: "Sterling Partners", sector: "healthcare", industry: "Healthcare Plans", country: "usa", exchange: "nasd", index: "sp500", marketCap: 914387.0, price: 486.75, change: -5.0, pe: 39.0, volume: 3911394, avgVolume: 1406064, dividendYield: 0.36, shortFloat: 2.33, analystRecom: 2.5, optionable: true, shortable: true, rsi: 38.2, beta: 1.32, volatility: 2.0, high52w: 540.68, low52w: 295.86, relVolume: 2.75},
    {ticker: "SP12", company: "Summit PLC", sector: "consumer cyclical", industry: "Department Stores", country: "germany", exchange: "amex", index: "", marketCap: 1271.0, price: 28.7, change: 4.29, pe: 24.2, volume: 4549, avgVolume: 2231, dividendYield: 0.45, shortFloat: 2.71, analystRecom: 2.8, optionable: false, shortable: true, rsi: 56.5, beta: 1.56, volatility: 3.8, high52w: 41.11, low52w: 21.1, relVolume: 0.74},
    {ticker: "SP3", company: "Summit Pharma", sector: "utilities", industry: "Utilities - Renewable", country: "usa", exchange: "nyse", index: "russell2000", marketCap: 83493.0, price: 68.57, change: 4.67, pe: 17.7, volume: 207165, avgVolume: 334755, dividendYield: 2.14, shortFloat: 1.52, analystRecom: 1.5, optionable: true, shortable: true, rsi: 58.5, beta: 1.03, volatility: 2.1, high52w: 80.98, low52w: 41.45, relVolume: 1.62},
    {ticker: "SR", company: "Summit Resources", sector: "healthcare", industry: "Pharmaceutical Retailers", country: "china", exchange: "amex", index: "russell2000", marketCap: 12.0, price: 49.7, change: -2.4, pe: 77.6, volume: 19, avgVolume: 110, dividendYield: 0.73, shortFloat: 2.73, analystRecom: 2.6, optionable: true, shortable: true, rsi: 44.9, beta: 1.16, volatility: 4.1, high52w: 61.97, low52w: 39.98, relVolume: 2.0},
    {ticker: "ST", company: "Strategic Technologies", sector: "healthcare", industry: "Pharmaceutical Retailers", country: "usa", exchange: "nyse", index: "djia", marketCap: 41919.0, price: 21.21, change: 2.82, pe: 34.9, volume: 289290, avgVolume: 83925, dividendYield: 0.84, shortFloat: 4.55, analystRecom: 1.8, optionable: true, shortable: true, rsi: 47.9, beta: 1.37, volatility: 1.3, high52w: 24.47, low52w: 15.83, relVolume: 1.0},
    {ticker: "SWP", company: "Sterling Web Partners", sector: "communication services", industry: "Internet Content & Information", country: "usa", exchange: "nasd", index: "russell2000", marketCap: 8259.0, price: 0.5, change: 1.39, pe: 20.2, volume: 58808, avgVolume: 43546, dividendYield: 0.69, shortFloat: 0.97, analystRecom: 2.1, optionable: true, shortable: true, rsi: 32.9, beta: 2.14, volatility: 4.8, high52w: 0.74, low52w: 0.41, relVolume: 1.14},
    {ticker: "T", company: "AT&T Inc", sector: "communication services", industry: "Telecom Services", country: "usa", exchange: "nyse", index: "sp500", marketCap: 6992.0, price: 30.55, change: -0.62, pe: 26.3, volume: 51238, avgVolume: 28716, dividendYield: 1.1, shortFloat: 4.16, analystRecom: 2.4, optionable: true, shortable: true, rsi: 34.8, beta: 0.54, volatility: 3.5, high52w: 44.94, low52w: 25.14, relVolume: 2.61},
    {ticker: "TMO", company: "Thermo Fisher Scientific Inc", sector: "healthcare", industry: "Diagnostics & Research", country: "usa", exchange: "nyse", index: "sp500", marketCap: 178025.0, price: 76.01, change: 4.23, pe: 10.9, volume: 900549, avgVolume: 873096, dividendYield: 2.78, shortFloat: 3.67, analystRecom: 3.1, optionable: true, shortable: true, rsi: 53.7, beta: 0.67, volatility: 2.7, high52w: 88.75, low52w: 61.27, relVolume: 1.02},
    {ticker: "TSLA", company: "Tesla Inc", sector: "consumer cyclical", industry: "Auto Manufacturers", country: "usa", exchange: "nasd", index: "sp500", marketCap: 36954.0, price: 5.39, change: -2.49, pe: 39.0, volume: 214741, avgVolume: 177924, dividendYield: 0.02, shortFloat: 3.9, analystRecom: 2.9, optionable: true, shortable: true, rsi: 57.2, beta: 2.49, volatility: 4.5, high52w: 7.37, low52w: 4.05, relVolume: 0.69},
    {ticker: "UD", company: "United Dynamics", sector: "basic materials", industry: "Other Precious Metals", country: "uk", exchange: "amex", index: "sp500", marketCap: 71691.0, price: 31.61, change: 3.2, pe: 46.3, volume: 404675, avgVolume: 567611, dividendYield: 0.19, shortFloat: 3.17, analystRecom: 2.3, optionable: true, shortable: true, rsi: 42.0, beta: 0.97, volatility: 4.6, high52w: 46.9, low52w: 24.08, relVolume: 1.51},
    {ticker: "UMB", company: "United Medicine BioTech", sector: "healthcare", industry: "Drug Manufacturers - General", country: "switzerland", exchange: "nyse", index: "", marketCap: 4820.0, price: 12.83, change: -3.92, pe: 24.3, volume: 5051, avgVolume: 8438, dividendYield: 2.61, shortFloat: 2.95, analystRecom: 1.7, optionable: true, shortable: true, rsi: 36.6, beta: 1.37, volatility: 2.1, high52w: 17.93, low52w: 9.75, relVolume: 2.39},
    {ticker: "UNH", company: "UnitedHealth Group Inc", sector: "healthcare", industry: "Healthcare Plans", country: "usa", exchange: "nyse", index: "sp500", marketCap: 810.0, price: 0.5, change: 0.08, pe: 62.6, volume: 3567, avgVolume: 2363, dividendYield: 0.85, shortFloat: 1.53, analystRecom: 1.7, optionable: true, shortable: true, rsi: 38.0, beta: 1.66, volatility: 0.9, high52w: 0.59, low52w: 0.37, relVolume: 2.6},
    {ticker: "UR", company: "United Resources", sector: "basic materials", industry: "Other Precious Metals", country: "south korea", exchange: "nyse", index: "sp500", marketCap: 2016.0, price: 32.16, change: -1.83, pe: 34.7, volume: 15169, avgVolume: 12677, dividendYield: 1.06, shortFloat: 4.39, analystRecom: 3.3, optionable: true, shortable: true, rsi: 25.3, beta: 0.71, volatility: 2.4, high52w: 43.18, low52w: 24.97, relVolume: 1.75},
    {ticker: "US", company: "United Systems", sector: "real estate", industry: "Real Estate - Development", country: "canada", exchange: "amex", index: "djia", marketCap: 1397.0, price: 2.81, change: 2.6, pe: 28.3, volume: 9515, avgVolume: 4713, dividendYield: 1.53, shortFloat: 0.58, analystRecom: 3.1, optionable: true, shortable: true, rsi: 70.3, beta: 2.47, volatility: 3.8, high52w: 3.82, low52w: 2.15, relVolume: 1.48},
    {ticker: "UT", company: "United Technologies", sector: "utilities", industry: "Utilities - Diversified", country: "china", exchange: "nyse", index: "djia", marketCap: 2312005.0, price: 2000, change: 4.99, pe: 12.5, volume: 18391401, avgVolume: 17208366, dividendYield: 4.01, shortFloat: 0.57, analystRecom: 1.7, optionable: true, shortable: true, rsi: 32.3, beta: 1.72, volatility: 2.9, high52w: 2471.62, low52w: 1487.28, relVolume: 1.35},
    {ticker: "V", company: "Visa Inc Class A", sector: "financial", industry: "Financial Data & Stock Exchanges", country: "usa", exchange: "nyse", index: "sp500", marketCap: 42.0, price: 27.93, change: 2.88, pe: 13.2, volume: 86, avgVolume: 101, dividendYield: 4.6, shortFloat: 0.83, analystRecom: 2.4, optionable: true, shortable: true, rsi: 31.1, beta: 1.04, volatility: 2.6, high52w: 35.12, low52w: 20.0, relVolume: 1.06},
    {ticker: "VB", company: "Vertex BioTech", sector: "utilities", industry: "Utilities - Regulated Water", country: "china", exchange: "nyse", index: "nasdaq100", marketCap: 573440.0, price: 242.73, change: 0.46, pe: 23.3, volume: 3739474, avgVolume: 3110643, dividendYield: 2.21, shortFloat: 3.84, analystRecom: 2.5, optionable: true, shortable: true, rsi: 51.5, beta: 1.75, volatility: 2.4, high52w: 346.26, low52w: 172.38, relVolume: 2.39},
    {ticker: "VC", company: "Vertex Corporation", sector: "utilities", industry: "Utilities - Regulated Electric", country: "china", exchange: "nyse", index: "djia", marketCap: 432919.0, price: 301.29, change: 2.84, pe: 22.3, volume: 804883, avgVolume: 3159191, dividendYield: 2.79, shortFloat: 2.77, analystRecom: 3.3, optionable: true, shortable: true, rsi: 57.3, beta: 1.51, volatility: 3.7, high52w: 345.1, low52w: 232.32, relVolume: 0.59},
    {ticker: "VD", company: "Vertex Dynamics", sector: "healthcare", industry: "Pharmaceutical Retailers", country: "china", exchange: "nyse", index: "sp500", marketCap: 9369.0, price: 0.5, change: 2.63, pe: 13.1, volume: 53008, avgVolume: 24703, dividendYield: 2.13, shortFloat: 4.44, analystRecom: 2.1, optionable: true, shortable: true, rsi: 56.0, beta: 1.81, volatility: 3.9, high52w: 0.67, low52w: 0.3, relVolume: 2.5},
    {ticker: "VH", company: "Vertex Holdings", sector: "consumer defensive", industry: "Packaged Foods", country: "canada", exchange: "nasd", index: "djia", marketCap: 98.0, price: 0.5, change: -3.85, pe: 35.0, volume: 588, avgVolume: 614, dividendYield: 5.83, shortFloat: 2.3, analystRecom: 2.3, optionable: true, shortable: false, rsi: 70.9, beta: 1.53, volatility: 3.7, high52w: 0.63, low52w: 0.32, relVolume: 1.2},
    {ticker: "VH1", company: "Vertex Holdings", sector: "energy", industry: "Oil & Gas Midstream", country: "south korea", exchange: "amex", index: "nasdaq100", marketCap: 149.0, price: 0.5, change: -4.0, pe: 19.1, volume: 1228, avgVolume: 987, dividendYield: 5.21, shortFloat: 4.41, analystRecom: 2.1, optionable: true, shortable: true, rsi: 73.3, beta: 1.23, volatility: 3.7, high52w: 0.56, low52w: 0.33, relVolume: 0.6},
    {ticker: "VI", company: "Vertex Industries", sector: "energy", industry: "Uranium", country: "usa", exchange: "cboe", index: "", marketCap: 3798.0, price: 0.5, change: 4.72, pe: 9.4, volume: 20999, avgVolume: 3932, dividendYield: 5.94, shortFloat: 2.44, analystRecom: 2.4, optionable: true, shortable: true, rsi: 39.9, beta: 0.68, volatility: 3.0, high52w: 0.69, low52w: 0.41, relVolume: 2.75},
    {ticker: "VI1", company: "Vertex Inc", sector: "real estate", industry: "REIT - Healthcare", country: "uk", exchange: "amex", index: "nasdaq100", marketCap: 125355.0, price: 73.49, change: 1.75, pe: 12.1, volume: 1148002, avgVolume: 467610, dividendYield: 0.82, shortFloat: 0.16, analystRecom: 3.0, optionable: true, shortable: true, rsi: 42.1, beta: 0.74, volatility: 1.1, high52w: 88.75, low52w: 57.81, relVolume: 2.07},
    {ticker: "VS", company: "Vertex Systems", sector: "financial", industry: "Banks - Regional", country: "germany", exchange: "cboe", index: "russell2000", marketCap: 12.0, price: 0.5, change: -3.24, pe: 10.0, volume: 113, avgVolume: 10, dividendYield: 3.07, shortFloat: 3.42, analystRecom: 2.5, optionable: true, shortable: true, rsi: 64.3, beta: 1.16, volatility: 3.8, high52w: 0.71, low52w: 0.3, relVolume: 2.33},
    {ticker: "VS1", company: "Vertex Solutions", sector: "consumer defensive", industry: "Packaged Foods", country: "france", exchange: "amex", index: "", marketCap: 12623.0, price: 51.92, change: 3.95, pe: 15.0, volume: 37164, avgVolume: 123871, dividendYield: 5.83, shortFloat: 1.06, analystRecom: 1.8, optionable: true, shortable: false, rsi: 48.3, beta: 0.34, volatility: 3.2, high52w: 65.75, low52w: 41.44, relVolume: 2.68},
    {ticker: "VSI", company: "Vertex SaaS Inc", sector: "technology", industry: "Software - Application", country: "usa", exchange: "amex", index: "djia", marketCap: 1596.0, price: 2.05, change: -2.92, pe: 97.6, volume: 13750, avgVolume: 5078, dividendYield: 0.33, shortFloat: 1.48, analystRecom: 3.4, optionable: true, shortable: true, rsi: 42.1, beta: 1.59, volatility: 3.6, high52w: 3.06, low52w: 1.65, relVolume: 2.04},
    {ticker: "VZ", company: "Verizon Communications Inc", sector: "communication services", industry: "Telecom Services", country: "usa", exchange: "nyse", index: "sp500", marketCap: 172112.0, price: 57.1, change: 3.49, pe: 48.3, volume: 869488, avgVolume: 940131, dividendYield: 0.51, shortFloat: 0.25, analystRecom: 1.6, optionable: true, shortable: true, rsi: 54.4, beta: 1.73, volatility: 4.2, high52w: 80.89, low52w: 40.93, relVolume: 2.32},
    {ticker: "WMT", company: "Walmart Inc", sector: "consumer defensive", industry: "Discount Stores", country: "usa", exchange: "nyse", index: "sp500", marketCap: 1607.0, price: 0.5, change: 1.01, pe: 25.4, volume: 8777, avgVolume: 14867, dividendYield: 3.5, shortFloat: 3.08, analystRecom: 1.6, optionable: true, shortable: true, rsi: 73.2, beta: 0.44, volatility: 4.2, high52w: 0.57, low52w: 0.42, relVolume: 2.1},
    {ticker: "XOM", company: "Exxon Mobil Corporation", sector: "energy", industry: "Oil & Gas Integrated", country: "usa", exchange: "nyse", index: "sp500", marketCap: 11.0, price: 0.5, change: -0.37, pe: 14.3, volume: 11, avgVolume: 52, dividendYield: 5.31, shortFloat: 2.7, analystRecom: 2.7, optionable: true, shortable: true, rsi: 25.6, beta: 1.59, volatility: 2.0, high52w: 0.62, low52w: 0.41, relVolume: 1.84}
];


let allStocks = [];
let filteredStocks = [];
let currentPage = 1;
const rowsPerPage = 20;
let currentSort = { field: 'ticker', direction: 'asc' };
let activeFilters = {};
let currentFilterType = 'descriptive';
let currentView = '111';

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

async function initializeApp() {
    // Load stock data
    await loadStockData();
    
    // Setup event listeners
    setupEventListeners();
    
    // Update datetime
    updateDatetime();
    
    // Initial render
    applyFilters();
}

async function loadStockData() {
    // Use embedded stock data for pure frontend operation
    allStocks = STOCKS_DATA;
    filteredStocks = [...allStocks];
    console.log('Loaded', allStocks.length, 'stocks from embedded data');
}

function setupEventListeners() {
    // Filter type tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            currentFilterType = this.dataset.filterType;
            
            // Show/hide filter sections
            document.querySelectorAll('.filter-section').forEach(section => {
                section.style.display = 'none';
            });
            
            if (currentFilterType === 'descriptive' || currentFilterType === 'all') {
                document.getElementById('descriptiveFilters').style.display = 'block';
            }
            if (currentFilterType === 'fundamental' || currentFilterType === 'all') {
                document.getElementById('fundamentalFilters').style.display = 'block';
            }
            if (currentFilterType === 'technical' || currentFilterType === 'all') {
                document.getElementById('technicalFilters').style.display = 'block';
            }
        });
    });
    
    // View tabs
    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            currentView = this.dataset.view;
            updateTableColumns(currentView);
        });
    });
    
    // Filter selects
    document.querySelectorAll('.screener-select').forEach(select => {
        select.addEventListener('change', function() {
            const filterName = this.dataset.filter;
            const value = this.value;
            
            if (value) {
                activeFilters[filterName] = value;
            } else {
                delete activeFilters[filterName];
            }
            
            currentPage = 1;
            applyFilters();
        });
    });
    
    // Order by select
    document.getElementById('orderSelect').addEventListener('change', function() {
        currentSort.field = this.value;
        applyFilters();
    });
    
    // Order direction select
    document.getElementById('orderDirSelect').addEventListener('change', function() {
        currentSort.direction = this.value;
        applyFilters();
    });
    
    // Signal select
    document.getElementById('signalSelect').addEventListener('change', function() {
        const value = this.value;
        if (value) {
            activeFilters['signal'] = value;
        } else {
            delete activeFilters['signal'];
        }
        currentPage = 1;
        applyFilters();
    });
    
    // Filters toggle
    document.getElementById('filtersToggle').addEventListener('click', function() {
        const panel = document.getElementById('filtersPanel');
        if (panel.style.display === 'none') {
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    });
    
    // Pagination - Top
    document.getElementById('pageSelect').addEventListener('change', function() {
        currentPage = parseInt(this.value);
        renderTable();
        updatePagination();
    });
    
    document.getElementById('prevPageTop').addEventListener('click', function() {
        if (currentPage > 1) {
            currentPage--;
            document.getElementById('pageSelect').value = currentPage;
            document.getElementById('pageSelectBottom').value = currentPage;
            renderTable();
            updatePagination();
        }
    });
    
    document.getElementById('nextPageTop').addEventListener('click', function() {
        const totalPages = Math.ceil(filteredStocks.length / rowsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            document.getElementById('pageSelect').value = currentPage;
            document.getElementById('pageSelectBottom').value = currentPage;
            renderTable();
            updatePagination();
        }
    });
    
    // Pagination - Bottom
    document.getElementById('pageSelectBottom').addEventListener('change', function() {
        currentPage = parseInt(this.value);
        renderTable();
        updatePagination();
    });
    
    document.getElementById('prevPageBottom').addEventListener('click', function() {
        if (currentPage > 1) {
            currentPage--;
            document.getElementById('pageSelect').value = currentPage;
            document.getElementById('pageSelectBottom').value = currentPage;
            renderTable();
            updatePagination();
        }
    });
    
    document.getElementById('nextPageBottom').addEventListener('click', function() {
        const totalPages = Math.ceil(filteredStocks.length / rowsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            document.getElementById('pageSelect').value = currentPage;
            document.getElementById('pageSelectBottom').value = currentPage;
            renderTable();
            updatePagination();
        }
    });
    
    // Table header sorting
    document.querySelectorAll('.table-header[data-sort]').forEach(header => {
        header.addEventListener('click', function() {
            const field = this.dataset.sort;
            if (currentSort.field === field) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.field = field;
                currentSort.direction = 'asc';
            }
            
            // Update header styles
            document.querySelectorAll('.table-header').forEach(h => {
                h.classList.remove('is-selected', 'is-ascending', 'is-descending');
            });
            this.classList.add('is-selected');
            this.classList.add(currentSort.direction === 'asc' ? 'is-ascending' : 'is-descending');
            
            // Update order selects
            document.getElementById('orderSelect').value = field;
            document.getElementById('orderDirSelect').value = currentSort.direction;
            
            applyFilters();
        });
    });
    
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', function() {
        document.body.classList.toggle('light-theme');
        document.body.classList.toggle('dark-theme');
    });
}

function applyFilters() {
    filteredStocks = allStocks.filter(stock => {
        // Apply all active filters
        for (const [filterName, value] of Object.entries(activeFilters)) {
            if (!matchesFilter(stock, filterName, value)) {
                return false;
            }
        }
        return true;
    });
    
    // Sort results
    sortStocks();
    
    // Reset to first page
    currentPage = 1;
    
    // Render
    renderTable();
    updatePagination();
    updateResultsCount();
}

function matchesFilter(stock, filterName, value) {
    switch (filterName) {
        case 'exch':
            return !value || stock.exchange === value;
        case 'idx':
            return !value || stock.index === value;
        case 'sec':
            return !value || stock.sector === value;
        case 'ind':
            return !value || stock.industry === value;
        case 'country':
            return !value || stock.country === value;
        case 'cap':
            return !value || matchesMarketCap(stock.marketCap, value);
        case 'fa_div':
            return !value || matchesDividendYield(stock.dividendYield, value);
        case 'sh_short':
            return !value || matchesShortFloat(stock.shortFloat, value);
        case 'an_recom':
            return !value || matchesAnalystRecom(stock.analystRecom, value);
        case 'sh_opt':
            return !value || matchesOptionShort(stock, value);
        case 'sh_price':
            return !value || matchesPrice(stock.price, value);
        case 'fa_pe':
            return !value || matchesPERatio(stock.pe, value);
        case 'sh_avgvol':
            return !value || matchesAvgVolume(stock.avgVolume, value);
        case 'signal':
            return !value || matchesSignal(stock, value);
        default:
            return true;
    }
}

function matchesMarketCap(marketCap, value) {
    const cap = parseMarketCap(marketCap);
    switch (value) {
        case 'mega': return cap >= 200000;
        case 'large': return cap >= 10000 && cap < 200000;
        case 'mid': return cap >= 2000 && cap < 10000;
        case 'small': return cap >= 300 && cap < 2000;
        case 'micro': return cap >= 50 && cap < 300;
        case 'nano': return cap < 50;
        case 'largeover': return cap >= 10000;
        case 'midover': return cap >= 2000;
        case 'smallover': return cap >= 300;
        case 'largeunder': return cap < 200000;
        case 'midunder': return cap < 10000;
        case 'smallunder': return cap < 2000;
        default: return true;
    }
}

function parseMarketCap(capStr) {
    if (typeof capStr === 'number') return capStr;
    const str = capStr.toString();
    if (str.includes('B')) return parseFloat(str) * 1000;
    if (str.includes('M')) return parseFloat(str);
    return parseFloat(str);
}

function matchesDividendYield(yieldValue, value) {
    const yieldNum = parseFloat(yieldValue) || 0;
    switch (value) {
        case 'none': return yieldNum === 0;
        case 'pos': return yieldNum > 0;
        case 'high': return yieldNum > 5;
        case 'veryhigh': return yieldNum > 10;
        case 'o1': return yieldNum > 1;
        case 'o2': return yieldNum > 2;
        case 'o3': return yieldNum > 3;
        case 'o5': return yieldNum > 5;
        default: return true;
    }
}

function matchesShortFloat(shortFloat, value) {
    const sf = parseFloat(shortFloat) || 0;
    switch (value) {
        case 'low': return sf < 5;
        case 'high': return sf > 20;
        case 'u5': return sf < 5;
        case 'u10': return sf < 10;
        case 'o5': return sf > 5;
        case 'o10': return sf > 10;
        case 'o20': return sf > 20;
        default: return true;
    }
}

function matchesAnalystRecom(recom, value) {
    const recomNum = parseFloat(recom) || 3;
    switch (value) {
        case 'strongbuy': return recomNum <= 1.5;
        case 'buybetter': return recomNum <= 2;
        case 'buy': return recomNum <= 2.5;
        case 'holdbetter': return recomNum <= 3;
        case 'hold': return recomNum > 2.5 && recomNum <= 3.5;
        case 'holdworse': return recomNum >= 3;
        case 'sell': return recomNum >= 3.5;
        case 'strongsell': return recomNum >= 4.5;
        default: return true;
    }
}

function matchesOptionShort(stock, value) {
    switch (value) {
        case 'option': return stock.optionable;
        case 'short': return stock.shortable;
        case 'notoption': return !stock.optionable;
        case 'notshort': return !stock.shortable;
        case 'optionshort': return stock.optionable && stock.shortable;
        default: return true;
    }
}

function matchesPrice(price, value) {
    const p = parseFloat(price) || 0;
    switch (value) {
        case 'u1': return p < 1;
        case 'u2': return p < 2;
        case 'u5': return p < 5;
        case 'u10': return p < 10;
        case 'u20': return p < 20;
        case 'u50': return p < 50;
        case 'o1': return p > 1;
        case 'o2': return p > 2;
        case 'o5': return p > 5;
        case 'o10': return p > 10;
        case 'o20': return p > 20;
        case 'o50': return p > 50;
        case '1to5': return p >= 1 && p <= 5;
        case '5to10': return p >= 5 && p <= 10;
        case '10to20': return p >= 10 && p <= 20;
        case '20to50': return p >= 20 && p <= 50;
        case '50to100': return p >= 50 && p <= 100;
        default: return true;
    }
}

function matchesPERatio(pe, value) {
    const peNum = parseFloat(pe);
    if (isNaN(peNum)) return value === '';
    switch (value) {
        case 'low': return peNum < 15;
        case 'high': return peNum > 25;
        case 'u10': return peNum < 10;
        case 'u15': return peNum < 15;
        case 'u20': return peNum < 20;
        case 'u25': return peNum < 25;
        case 'o10': return peNum > 10;
        case 'o15': return peNum > 15;
        case 'o20': return peNum > 20;
        case 'o25': return peNum > 25;
        default: return true;
    }
}

function matchesAvgVolume(avgVol, value) {
    const vol = parseVolume(avgVol);
    switch (value) {
        case 'u50k': return vol < 50000;
        case 'u100k': return vol < 100000;
        case 'u500k': return vol < 500000;
        case 'u1m': return vol < 1000000;
        case 'o50k': return vol > 50000;
        case 'o100k': return vol > 100000;
        case 'o500k': return vol > 500000;
        case 'o1m': return vol > 1000000;
        default: return true;
    }
}

function parseVolume(volStr) {
    if (typeof volStr === 'number') return volStr;
    const str = volStr.toString();
    if (str.includes('M')) return parseFloat(str) * 1000000;
    if (str.includes('K')) return parseFloat(str) * 1000;
    return parseFloat(str);
}

function matchesSignal(stock, signal) {
    // Simplified signal matching
    switch (signal) {
        case 'ta_topgainers': return stock.change > 5;
        case 'ta_toplosers': return stock.change < -5;
        case 'ta_newhigh': return stock.price >= stock.high52w * 0.98;
        case 'ta_newlow': return stock.price <= stock.low52w * 1.02;
        case 'ta_mostvolatile': return stock.volatility > 5;
        case 'ta_mostactive': return parseVolume(stock.volume) > 5000000;
        case 'ta_unusualvolume': return stock.relVolume > 2;
        case 'ta_overbought': return stock.rsi > 70;
        case 'ta_oversold': return stock.rsi < 30;
        default: return true;
    }
}

function sortStocks() {
    const field = currentSort.field;
    const direction = currentSort.direction === 'asc' ? 1 : -1;
    
    filteredStocks.sort((a, b) => {
        let aVal = a[field];
        let bVal = b[field];
        
        // Handle special cases
        if (field === 'marketcap') {
            aVal = parseMarketCap(aVal);
            bVal = parseMarketCap(bVal);
        } else if (field === 'volume' || field === 'avgVolume') {
            aVal = parseVolume(aVal);
            bVal = parseVolume(bVal);
        } else if (field === 'price' || field === 'pe' || field === 'change') {
            aVal = parseFloat(aVal) || 0;
            bVal = parseFloat(bVal) || 0;
        }
        
        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
        return 0;
    });
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const pageStocks = filteredStocks.slice(start, end);
    
    tbody.innerHTML = pageStocks.map((stock, index) => `
        <tr>
            <td data-column="no">${start + index + 1}</td>
            <td data-column="ticker"><a href="#">${stock.ticker}</a></td>
            <td data-column="company">${stock.company}</td>
            <td data-column="sector">${stock.sector}</td>
            <td data-column="industry">${stock.industry}</td>
            <td data-column="country">${stock.country}</td>
            <td data-column="marketcap">${formatMarketCap(stock.marketCap)}</td>
            <td data-column="pe" class="${stock.pe === '-' ? '' : (parseFloat(stock.pe) > 25 ? 'negative' : '')}">${stock.pe}</td>
            <td data-column="price">${stock.price}</td>
            <td data-column="change" class="${stock.change >= 0 ? 'positive' : 'negative'}">${formatChange(stock.change)}</td>
            <td data-column="volume">${formatVolume(stock.volume)}</td>
        </tr>
    `).join('');
}

function updatePagination() {
    const totalPages = Math.ceil(filteredStocks.length / rowsPerPage) || 1;
    
    // Update page selects
    const pageSelect = document.getElementById('pageSelect');
    const pageSelectBottom = document.getElementById('pageSelectBottom');
    
    const options = [];
    for (let i = 1; i <= totalPages; i++) {
        options.push(`<option value="${i}">Page ${i} / ${totalPages}</option>`);
    }
    
    pageSelect.innerHTML = options.join('');
    pageSelectBottom.innerHTML = options.join('');
    
    pageSelect.value = currentPage;
    pageSelectBottom.value = currentPage;
    
    // Update buttons
    document.getElementById('prevPageTop').disabled = currentPage === 1;
    document.getElementById('prevPageBottom').disabled = currentPage === 1;
    document.getElementById('nextPageTop').disabled = currentPage === totalPages;
    document.getElementById('nextPageBottom').disabled = currentPage === totalPages;
}

function updateResultsCount() {
    const start = (currentPage - 1) * rowsPerPage + 1;
    const end = Math.min(currentPage * rowsPerPage, filteredStocks.length);
    const total = filteredStocks.length;
    
    if (total === 0) {
        document.getElementById('resultsCount').textContent = '#0 / 0 Total';
    } else {
        document.getElementById('resultsCount').textContent = `#${start}-${end} / ${total} Total`;
    }
}

function updateTableColumns(view) {
    // Update table headers based on view
    const headers = {
        '111': ['No.', 'Ticker', 'Company', 'Sector', 'Industry', 'Country', 'Market Cap', 'P/E', 'Price', 'Change', 'Volume'],
        '121': ['No.', 'Ticker', 'Company', 'P/E', 'Forward P/E', 'PEG', 'P/S', 'P/B', 'P/C', 'P/FCF', 'Dividend Yield'],
        '161': ['No.', 'Ticker', 'Company', 'Sales', 'Sales Growth', 'EPS', 'EPS Growth', 'ROE', 'ROA', 'Margin', 'Debt/Equity'],
        '131': ['No.', 'Ticker', 'Company', 'Insider Own', 'Insider Trans', 'Inst Own', 'Inst Trans', 'Short Float', 'Short Ratio', 'Short Interest'],
        '141': ['No.', 'Ticker', 'Company', 'Perf Week', 'Perf Month', 'Perf Quart', 'Perf Half', 'Perf Year', 'Perf YTD', 'Perf 3Y', 'Perf 5Y'],
        '171': ['No.', 'Ticker', 'Company', 'SMA20', 'SMA50', 'SMA200', '52W High', '52W Low', 'RSI', 'Beta', 'Volatility'],
    };
    
    const columns = headers[view] || headers['111'];
    const headerRow = document.getElementById('tableHeader');
    
    headerRow.innerHTML = columns.map((col, index) => {
        const sortField = getSortFieldForColumn(col);
        return `<th class="table-header ${index === 1 ? 'is-selected is-ascending' : ''}" data-sort="${sortField}">${col}</th>`;
    }).join('');
}

function getSortFieldForColumn(col) {
    const mapping = {
        'No.': 'no',
        'Ticker': 'ticker',
        'Company': 'company',
        'Sector': 'sector',
        'Industry': 'industry',
        'Country': 'country',
        'Market Cap': 'marketcap',
        'P/E': 'pe',
        'Price': 'price',
        'Change': 'change',
        'Volume': 'volume',
    };
    return mapping[col] || 'ticker';
}

function formatMarketCap(value) {
    if (typeof value === 'number') {
        if (value >= 1000) return (value / 1000).toFixed(2) + 'T';
        if (value >= 1) return value.toFixed(2) + 'B';
        return (value * 1000).toFixed(0) + 'M';
    }
    return value;
}

function formatChange(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return (num >= 0 ? '+' : '') + num.toFixed(2) + '%';
}

function formatVolume(value) {
    if (typeof value === 'number') {
        if (value >= 1000000) return (value / 1000000).toFixed(2) + 'M';
        if (value >= 1000) return (value / 1000).toFixed(0) + 'K';
        return value.toString();
    }
    return value;
}

function updateDatetime() {
    const now = new Date();
    const options = { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    };
    document.getElementById('headerDatetime').textContent = 
        now.toLocaleDateString('en-US', options) + ' ET';
}

function applyTickersFilter() {
    const input = document.getElementById('tickersInput').value.trim();
    if (!input) {
        delete activeFilters['tickers'];
    } else {
        const tickers = input.split(',').map(t => t.trim().toUpperCase());
        activeFilters['tickers'] = tickers;
    }
    currentPage = 1;
    applyFilters();
}

// Override matchesFilter to handle tickers
const originalMatchesFilter = matchesFilter;
matchesFilter = function(stock, filterName, value) {
    if (filterName === 'tickers' && Array.isArray(value)) {
        return value.includes(stock.ticker.toUpperCase());
    }
    return originalMatchesFilter(stock, filterName, value);
};
