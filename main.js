// Select main SVG element and define fixed dimensions and margins
const svg = d3.select("#chart");
const width = 1080;
const height = 500;
const margin = { top: 26, right: 28, bottom: 52, left: 88 };

// Formats large numbers (e.g., 1M, 1B) for better readability on axes
function formatAxisTick(v) {
  return d3.format("~s")(v).replace(/G/g, "B");
}

// Color palette assigned to each continent
const continentColor = {
  Asia: "#e6c200",
  Africa: "#1a1a1a",
  Europe: "#2563eb",
  America: "#dc2626",
  Oceania: "#16a34a",
  Other: "#6b7280",
};

/** Stable draw order for continent aggregation (up to six points). */
const continentOrder = [
  "Asia",
  "Europe",
  "Africa",
  "America",
  "Oceania",
  "Other",
];

// Maps country codes to continents (fallback to "Other" if not found)
function continentFor(code) {
  const map = window.continentByCode;
  return map && map[code] ? map[code] : "Other";
}

// Creates hidden tooltip element that appears on hover
const tooltip = d3
  .select("body")
  .append("div")
  .style("position", "absolute")
  .style("font-family", '"Open Sans", system-ui, sans-serif')
  .style("background", "white")
  .style("border", "1px solid #ccc")
  .style("padding", "8px 10px")
  .style("border-radius", "4px")
  .style("font-size", "13px")
  .style("box-shadow", "0 2px 6px rgba(0,0,0,0.12)")
  .style("display", "none")
  .style("pointer-events", "none")
  .style("z-index", "10");

// Load CSV data and initialize all visualization logic
d3.csv("co2_vs_population_data.csv").then((data) => {
  // and assign continent based on country code
  data.forEach((d) => {
    d.co2 = +d.co2;
    d.population = +d.population;
    d.year = +d.year;
    d.continent = continentFor(d["country code"]);
  });

  // Build lookup: country code → { name, continent }
  const metaByCode = d3.rollup(
    data,
    (v) => ({
      code: v[0]["country code"],
      name: v[0]["country name"],
      continent: v[0].continent,
    }),
    (d) => d["country code"],
  );

  // Group countries by continent for filter UI
  const countriesByContinent = new Map();
  continentOrder.forEach((c) => countriesByContinent.set(c, []));
  for (const row of metaByCode.values()) {
    const arr = countriesByContinent.get(row.continent);
    if (arr) arr.push({ code: row.code, name: row.name });
  }

  // Sort countries alphabetically inside each continent
  countriesByContinent.forEach((arr) =>
    arr.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    ),
  );
  const allCountryCodes = Array.from(metaByCode.keys());
  const selectedCodes = new Set(allCountryCodes);
  const expandedContinents = new Set(continentOrder);

  // Extract and sort all unique years from dataset
  const years = Array.from(new Set(data.map((d) => d.year))).sort(
    (a, b) => a - b,
  );

  // Configure year slider and label
  const slider = d3.select("#yearSlider");
  const label = d3.select("#yearLabel");

  slider
    .attr("min", d3.min(years))
    .attr("max", d3.max(years))
    .attr("step", 1)
    .property("value", years[0]);

  label.text(years[0]);

  // Aggregate country data into continent-level totals for a given year
  function continentRowsForYear(year) {
    const filtered = data.filter(
      (d) => d.year === year && selectedCodes.has(d["country code"]),
    );
    return continentOrder
      .map((continent) => {
        const subset = filtered.filter((d) => d.continent === continent);
        return {
          continent,
          population: d3.sum(subset, (d) => d.population),
          co2: d3.sum(subset, (d) => d.co2),
        };
      })
      .filter((d) => d.population > 0 && d.co2 > 0);
  }

  // Compute global min/max values for population and CO2
  // (including continent aggregates)
  const minPop = Math.max(
    1,
    d3.min(data, (d) => d.population),
  );
  let maxPop = d3.max(data, (d) => d.population);
  const minCO2 = Math.max(
    1,
    d3.min(data, (d) => d.co2),
  );
  let maxCO2 = d3.max(data, (d) => d.co2);
  for (const y of years) {
    for (const row of continentRowsForYear(y)) {
      maxPop = Math.max(maxPop, row.population);
      maxCO2 = Math.max(maxCO2, row.co2);
    }
  }

  /** Log axes: same caps for countries and continents. */
  const CAP_LOG_POP = 10e9;
  const CAP_LOG_CO2 = 100e6;
  /** Linear axes: only for country view (continent view uses full data range). */
  const CAP_LINEAR_POP_COUNTRIES = 15e8;
  const CAP_LINEAR_CO2_COUNTRIES = 13e6;

  let x;
  let y;

  svg.style("font-family", '"Open Sans", system-ui, sans-serif');

  // Create groups for grid, axes, and plot area
  const gridG = svg
    .append("g")
    .attr("class", "grid")
    .style("pointer-events", "none");

  const gx = svg
    .append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${height - margin.bottom})`);

  const gy = svg
    .append("g")
    .attr("class", "axis axis-y")
    .attr("transform", `translate(${margin.left},0)`);

  const plot = svg.append("g").attr("class", "plot");

  // Axis titles (labels for X and Y axes)
  const titleX = svg
    .append("text")
    .attr("class", "axis-title axis-title-x")
    .attr("text-anchor", "middle")
    .attr("x", margin.left + (width - margin.left - margin.right) / 2)
    .attr("y", height - 12)
    .attr("fill", "#334155")
    .attr("font-size", "13px")
    .attr("font-weight", "600");

  const titleY = svg
    .append("text")
    .attr("class", "axis-title axis-title-y")
    .attr("text-anchor", "middle")
    .attr(
      "transform",
      `translate(${22},${margin.top + (height - margin.top - margin.bottom) / 2}) rotate(-90)`,
    )
    .attr("fill", "#334155")
    .attr("font-size", "13px")
    .attr("font-weight", "600");

  // Ensures data points stay within axis domain limits
  function clampToDomain(scale, v) {
    let [a, b] = scale.domain();
    if (a > b) {
      [a, b] = [b, a];
    }
    return Math.min(Math.max(v, a), b);
  }

  // Recompute scales and redraw axes when mode or scale changes
  function refreshScalesAndAxes() {
    const linear = d3.select("#scaleToggle").property("checked");
    const continents = isContinentMode();

    // Choose between linear and logarithmic scales
    // and between country-level and continent-level domains
    if (linear) {
      if (continents) {
        x = d3
          .scaleLinear()
          .domain([0, maxPop])
          .range([margin.left, width - margin.right])
          .nice();
        y = d3
          .scaleLinear()
          .domain([0, maxCO2])
          .range([height - margin.bottom, margin.top])
          .nice();
      } else {
        x = d3
          .scaleLinear()
          .domain([0, CAP_LINEAR_POP_COUNTRIES])
          .range([margin.left, width - margin.right]);
        y = d3
          .scaleLinear()
          .domain([0, CAP_LINEAR_CO2_COUNTRIES])
          .range([height - margin.bottom, margin.top]);
      }
    } else {
      const popHi = Math.min(maxPop, CAP_LOG_POP);
      const co2Hi = Math.min(maxCO2, CAP_LOG_CO2);
      x = d3
        .scaleLog()
        .domain([minPop, popHi])
        .range([margin.left, width - margin.right])
        .nice();
      y = d3
        .scaleLog()
        .domain([minCO2, co2Hi])
        .range([height - margin.bottom, margin.top])
        .nice();
      const xd = x.domain();
      x.domain([xd[0], Math.min(xd[1], CAP_LOG_POP)]);
      const yd = y.domain();
      y.domain([yd[0], Math.min(yd[1], CAP_LOG_CO2)]);
    }

    if (linear && continents) {
      const xd = x.domain();
      if (xd[0] < 0) x.domain([0, xd[1]]);
      const yd = y.domain();
      if (yd[0] < 0) y.domain([0, yd[1]]);
    }

    const tickTarget = linear ? 7 : 5;
    const xAxis = d3
      .axisBottom(x)
      .ticks(tickTarget)
      .tickFormat(formatAxisTick)
      .tickSizeInner(8)
      .tickSizeOuter(0)
      .tickPadding(10);
    const yAxis = d3
      .axisLeft(y)
      .ticks(tickTarget)
      .tickFormat(formatAxisTick)
      .tickSizeInner(8)
      .tickSizeOuter(0)
      .tickPadding(10);

    // Clear previous axes before redrawing
    gx.selectAll("*").remove();
    gy.selectAll("*").remove();

    gx.call(xAxis);
    gy.call(yAxis);

    const domainStroke = "#1e293b";
    const domainWidth = 2.5;
    const tickStroke = "#64748b";
    const tickWidth = 1.35;

    // Apply custom styling to axes (lines, ticks, labels)
    function styleAxis(selection) {
      selection
        .select("path.domain")
        .attr("stroke", domainStroke)
        .attr("stroke-width", domainWidth)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("fill", "none");
      selection
        .selectAll(".tick line")
        .attr("stroke", tickStroke)
        .attr("stroke-width", tickWidth)
        .attr("stroke-opacity", 0.9);
      selection
        .selectAll(".tick text")
        .attr("fill", "#475569")
        .attr("font-size", "11.5px")
        .attr("font-weight", "600")
        .attr("font-family", '"Open Sans", system-ui, sans-serif');
    }

    styleAxis(gx);
    styleAxis(gy);

    gx.append("path")
      .attr("class", "axis-arrow axis-arrow-x")
      .attr("fill", domainStroke)
      .attr("d", "M0,0L-12,-5.5L-12,5.5Z")
      .attr("transform", `translate(${x.range()[1]},0)`);

    gy.append("path")
      .attr("class", "axis-arrow axis-arrow-y")
      .attr("fill", domainStroke)
      .attr("d", "M0,0L-5.5,12L5.5,12Z")
      .attr("transform", `translate(0,${y.range()[1]})`);

    const xGridTicks = linear ? x.ticks(10) : x.ticks(5);
    const yGridTicks = linear ? y.ticks(10) : y.ticks(5);

    // Draw background grid lines for better readability
    gridG
      .selectAll("line.grid-x")
      .data(xGridTicks)
      .join(
        (enter) => enter.append("line").attr("class", "grid-x"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("y1", margin.top)
      .attr("y2", height - margin.bottom)
      .attr("stroke", "#e2e8f0")
      .attr("stroke-opacity", 0.98)
      .attr("stroke-dasharray", "3 5")
      .attr("stroke-width", 1);

    gridG
      .selectAll("line.grid-y")
      .data(yGridTicks)
      .join(
        (enter) => enter.append("line").attr("class", "grid-y"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d))
      .attr("stroke", "#e2e8f0")
      .attr("stroke-opacity", 0.98)
      .attr("stroke-dasharray", "3 5")
      .attr("stroke-width", 1);

    titleX.text(
      `Population (${linear ? "linear" : "log"} scale, number of people)`,
    );
    titleY.text(
      `CO₂ emissions (${linear ? "linear" : "log"} scale, kilotonnes)`,
    );
  }

  // Convert data values to screen coordinates
  function cx(d) {
    return x(clampToDomain(x, d.population));
  }

  function cy(d) {
    return y(clampToDomain(y, d.co2));
  }

  // Defines fill and stroke styles for circles
  function dotStyle(d, linearCountryView) {
    const c = continentColor[d.continent] ?? continentColor.Other;
    const isAfrica = d.continent === "Africa";
    if (linearCountryView) {
      return {
        fill: c,
        stroke: isAfrica ? "#e8eaed" : "rgba(255,255,255,0.95)",
        "stroke-width": isAfrica ? 1.45 : 1.05,
      };
    }
    return {
      fill: c,
      stroke: isAfrica ? "#d1d5db" : "rgba(255,255,255,0.35)",
      "stroke-width": isAfrica ? 1.25 : 0.75,
    };
  }

  // Check whether current view is continent aggregation mode
  function isContinentMode() {
    return d3.select("#viewToggle").property("checked");
  }

  // Update UI labels for view toggle (countries vs continents)
  function syncToggleLabels() {
    const on = isContinentMode();
    d3.select(".toggle-countries").classed("active", !on);
    d3.select(".toggle-continents").classed("active", on);
  }

  // Update UI labels for scale toggle (log vs linear)
  function syncScaleToggleLabels() {
    const linear = d3.select("#scaleToggle").property("checked");
    d3.select(".toggle-scale-log").classed("active", !linear);
    d3.select(".toggle-scale-linear").classed("active", linear);
  }

  // Re-render chart when year, filters, or modes change
  function update(year) {
    const continentMode = isContinentMode();
    const linear = d3.select("#scaleToggle").property("checked");
    const linearCountryView = linear && !continentMode;

    // Select data depending on current mode (countries or continents)
    let filtered = continentMode
      ? continentRowsForYear(year)
      : data.filter(
          (d) => d.year === year && selectedCodes.has(d["country code"]),
        );

    // Radius proportional to CO2 (area ∝ CO2)
    let radiusFn = null;

    if (linearCountryView && filtered.length > 0) {
      const co2Extent = d3.extent(filtered, (d) => d.co2);

      const rScale = d3.scaleSqrt().domain(co2Extent).range([2, 14]); // min/max size — можешь подстроить

      radiusFn = (d) => rScale(d.co2);
    }

    // Sort points in linear country mode to reduce overlap issues
    if (linearCountryView) {
      filtered = [...filtered].sort(
        (a, b) => a.population - b.population || a.co2 - b.co2,
      );
    }

    const dotRadius = continentMode ? 33 : linearCountryView ? 4 : 5;
    const dotOpacity = continentMode ? 0.88 : linearCountryView ? 0.7 : 0.78;
    const keyFn = continentMode ? (d) => d.continent : (d) => d["country code"];

    // Bind data to circle elements
    const circles = plot.selectAll("circle").data(filtered, keyFn);

    circles
      .enter() // Create new circles for incoming data points
      .append("circle")
      .attr("r", (d) => (radiusFn ? radiusFn(d) : dotRadius))
      .attr("opacity", dotOpacity)
      .style("cursor", "pointer")
      .merge(circles)
      .attr("r", (d) => (radiusFn ? radiusFn(d) : dotRadius))
      .attr("opacity", dotOpacity)
      .attr("cx", (d) => cx(d))
      .attr("cy", (d) => cy(d))
      .each(function (d) {
        const s = dotStyle(d, linearCountryView);
        d3.select(this)
          .attr("fill", s.fill)
          .attr("stroke", s.stroke)
          .attr(
            "stroke-width",
            continentMode ? s["stroke-width"] * 1.4 : s["stroke-width"],
          );
      })
      // Tooltip behavior on hover
      .on("mouseover", function (event, d) {
        d3.select(this).raise();
        tooltip.style("display", "block");
        if (continentMode) {
          tooltip.html(
            `<strong>${d.continent}</strong> (total)<br/>` +
              `Population: ${d3.format(",")(Math.round(d.population))}<br/>` +
              `CO₂: ${d3.format(",")(Math.round(d.co2))} kt`,
          );
        } else {
          const clipped =
            linearCountryView &&
            (d.population > CAP_LINEAR_POP_COUNTRIES ||
              d.co2 > CAP_LINEAR_CO2_COUNTRIES);
          tooltip.html(
            `<strong>${d["country name"]}</strong> (${d["country code"]})<br/>` +
              `Continent: ${d.continent}<br/>` +
              `Population: ${d3.format(",")(d.population)}<br/>` +
              `CO₂: ${d3.format(",")(d.co2)} kt` +
              (clipped
                ? `<br/><span style="color:#64748b;font-size:12px">Plotted at chart edge (exceeds linear axis range)</span>`
                : ""),
          );
        }
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY + 12}px`);
      })
      .on("mouseout", function () {
        tooltip.style("display", "none");
      });

    circles.exit().remove();

    label.text(year);
  }

  // Builds hierarchical filter (continent → countries)
  function renderFilterTree() {
    // Clear and rebuild filter tree
    const root = document.getElementById("filterTree");
    if (!root) return;
    root.replaceChildren();

    // Iterate over continents and create UI blocks
    continentOrder.forEach((cont) => {
      const countries = countriesByContinent.get(cont);
      if (!countries || countries.length === 0) return;

      const block = document.createElement("div");
      block.className = "filter-continent-block";

      const header = document.createElement("div");
      header.className = "filter-continent-header";

      const expBtn = document.createElement("button");
      expBtn.type = "button";
      expBtn.className = "filter-expand";
      const isOpen = expandedContinents.has(cont);
      expBtn.setAttribute("aria-label", isOpen ? "Collapse" : "Expand");
      expBtn.textContent = isOpen ? "▼" : "▶";
      expBtn.addEventListener("click", () => {
        if (expandedContinents.has(cont)) expandedContinents.delete(cont);
        else expandedContinents.add(cont);
        renderFilterTree();
      });
      header.appendChild(expBtn);

      const nSel = countries.filter((c) => selectedCodes.has(c.code)).length;
      const lab = document.createElement("label");
      lab.className = "filter-continent-label";

      // Checkbox controls selection of all countries in continent
      const contCb = document.createElement("input");
      contCb.type = "checkbox";
      contCb.checked = nSel === countries.length;
      contCb.indeterminate = nSel > 0 && nSel < countries.length;
      contCb.addEventListener("change", () => {
        const on = contCb.checked;
        countries.forEach(({ code }) => {
          if (on) selectedCodes.add(code);
          else selectedCodes.delete(code);
        });
        renderFilterTree();
        update(+slider.property("value"));
      });
      lab.appendChild(contCb);
      const titleSpan = document.createElement("span");
      titleSpan.className = "filter-continent-title";
      const contNameEl = document.createElement("span");
      contNameEl.className = "filter-continent-name";
      contNameEl.textContent = cont;
      contNameEl.style.color = continentColor[cont] ?? continentColor.Other;
      titleSpan.appendChild(contNameEl);
      titleSpan.appendChild(document.createTextNode(" "));
      const meta = document.createElement("span");
      meta.className = "filter-continent-meta";
      meta.textContent = `(${nSel}/${countries.length})`;
      titleSpan.appendChild(meta);
      lab.appendChild(titleSpan);
      header.appendChild(lab);
      block.appendChild(header);

      const list = document.createElement("div");
      list.className = "filter-country-list";
      list.hidden = !isOpen;

      // Create checkbox for each country
      countries.forEach(({ code, name }) => {
        const row = document.createElement("div");
        row.className = "filter-country-row";
        const rowLab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selectedCodes.has(code);
        cb.addEventListener("change", () => {
          if (cb.checked) selectedCodes.add(code);
          else selectedCodes.delete(code);
          renderFilterTree();
          update(+slider.property("value"));
        });
        rowLab.appendChild(cb);
        const nameSpan = document.createElement("span");
        nameSpan.className = "filter-country-name";
        nameSpan.textContent = name;
        nameSpan.title = `${name} (${code})`;
        rowLab.appendChild(nameSpan);
        const codeSpan = document.createElement("span");
        codeSpan.className = "filter-country-code";
        codeSpan.textContent = code;
        row.appendChild(rowLab);
        row.appendChild(codeSpan);
        list.appendChild(row);
      });

      block.appendChild(list);
      root.appendChild(block);
    });
  }

  // Show/hide filter panel
  const filterDropdownBtn = document.getElementById("filterDropdownBtn");
  const filterPanel = document.getElementById("filterPanel");
  if (filterDropdownBtn && filterPanel) {
    filterDropdownBtn.addEventListener("click", () => {
      filterPanel.hidden = !filterPanel.hidden;
      filterDropdownBtn.setAttribute(
        "aria-expanded",
        String(!filterPanel.hidden),
      );
    });
  }

  // Select or deselect all countries
  d3.select("#selectAllFilter").on("click", () => {
    allCountryCodes.forEach((c) => selectedCodes.add(c));
    renderFilterTree();
    update(+slider.property("value"));
  });

  d3.select("#deselectAllFilter").on("click", () => {
    selectedCodes.clear();
    renderFilterTree();
    update(+slider.property("value"));
  });

  // Update chart when slider changes
  slider.on("input", function () {
    update(+this.value);
  });

  // Update chart when view mode or scale mode changes
  d3.select("#viewToggle").on("change", function () {
    syncToggleLabels();
    refreshScalesAndAxes();
    update(+slider.property("value"));
  });

  d3.select("#scaleToggle").on("change", function () {
    syncScaleToggleLabels();
    refreshScalesAndAxes();
    update(+slider.property("value"));
  });

  // Sync UI state and render initial visualization
  syncToggleLabels();
  syncScaleToggleLabels();
  refreshScalesAndAxes();
  renderFilterTree();
  update(years[0]);
});
