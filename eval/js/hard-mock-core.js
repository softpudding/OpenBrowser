(function () {
  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uniqueSorted(values) {
    return Array.from(new Set((values || []).filter(Boolean))).sort();
  }

  function formatCurrency(amount, currency) {
    const numericAmount = Number(amount || 0);
    return `${currency || "$"}${numericAmount.toFixed(0)}`;
  }

  function formatLongDate(value) {
    if (!value) {
      return "";
    }

    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function debounce(callback, wait) {
    let timeoutId = null;

    return function debounced(...args) {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => callback.apply(this, args), wait);
    };
  }

  function getSearchTerms(query) {
    return normalize(query)
      .split(/\s+/)
      .filter(Boolean);
  }

  function createSeededStore(config) {
    const storageKey = config.storageKey;
    const seedState = deepClone(config.seedState);
    const query = new URLSearchParams(window.location.search);

    if (query.get("reset") === "1") {
      window.localStorage.removeItem(storageKey);
    }

    let state = seedState;
    const existingValue = window.localStorage.getItem(storageKey);
    if (existingValue) {
      try {
        state = JSON.parse(existingValue);
      } catch (error) {
        state = seedState;
      }
    }

    if (typeof config.migrate === "function") {
      state = config.migrate(state, seedState);
    }

    function persist(nextState) {
      state = nextState;
      window.localStorage.setItem(storageKey, JSON.stringify(state));
      return state;
    }

    persist(state);

    if (query.get("reset") === "1") {
      query.delete("reset");
      const nextQuery = query.toString();
      const nextUrl = `${window.location.pathname}${
        nextQuery ? `?${nextQuery}` : ""
      }${window.location.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }

    return {
      getState() {
        return deepClone(state);
      },
      save(nextState) {
        return deepClone(persist(nextState));
      },
      update(mutator) {
        const draft = deepClone(state);
        const nextState = mutator(draft) || draft;
        return deepClone(persist(nextState));
      },
      reset() {
        return deepClone(persist(deepClone(seedState)));
      },
    };
  }

  function parseOperatorQuery(query) {
    const source = String(query || "");
    const operators = {};
    let remainder = source;
    const pattern = /([a-z]+):("[^"]+"|\S+)/gi;
    let match = pattern.exec(source);

    while (match) {
      const key = match[1].toLowerCase();
      const rawValue = match[2].replace(/^"|"$/g, "");
      operators[key] = rawValue;
      remainder = remainder.replace(match[0], " ");
      match = pattern.exec(source);
    }

    return {
      operators,
      terms: getSearchTerms(remainder),
    };
  }

  function matchesTerms(haystack, terms) {
    const normalizedHaystack = normalize(haystack);
    return (terms || []).every((term) => normalizedHaystack.includes(normalize(term)));
  }

  window.HardMockSite = {
    createSeededStore,
    debounce,
    deepClone,
    escapeHtml,
    formatCurrency,
    formatLongDate,
    getSearchTerms,
    matchesTerms,
    normalize,
    parseOperatorQuery,
    uniqueSorted,
  };
})();
