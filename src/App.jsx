import React, { startTransition, useEffect, useMemo, useState } from 'react';
import dataset from './data/idmDataset.json';
import geojson from './data/peMunicipios.json';

const MUNICIPALITY_ALIASES = {
  'belem de sao francisco': 'belem do sao francisco',
  'iguaraci': 'iguaracy',
  'lagoa do itaenga': 'lagoa de itaenga',
  'sao caitano': 'sao caetano',
};

const MACRO_COPY = {
  Metropolitana: 'Maior densidade institucional e economica, com forte presenca de servicos, logistica urbana e pressao ambiental.',
  Agreste: 'Rede de cidades medias que articula comercio, educacao, saude regional e conexoes produtivas do interior.',
  'Sertão Pernambucano': 'Territorio extenso com polos emergentes, desafios climaticos persistentes e forte peso das capacidades publicas locais.',
  'Vale São Francisco/Araripe': 'Faixa estrategica marcada por irrigacao, energia, cadeias exportadoras e dinamicas urbanas especializadas.',
};

function getMetricValue(municipality, year, metricKey) {
  if (!municipality) return null;
  if (metricKey === 'idm') return municipality.idm?.[year] ?? null;
  if (metricKey.startsWith('dimension:')) return municipality.dimensions?.[metricKey.split(':')[1]]?.[year] ?? null;
  if (metricKey.startsWith('indicator:')) return municipality.indicators?.[year]?.[metricKey.split(':')[1]] ?? null;
  return null;
}

function formatDecimal(value, digits = 3) {
  return value == null ? 'Sem dado' : value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatDelta(value) {
  if (value == null) return 'Sem base anterior';
  return `${value >= 0 ? '+' : ''}${formatDecimal(value, 3)}`;
}

function slugify(value) {
  const base = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return MUNICIPALITY_ALIASES[base] ?? base;
}

function getRouteFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return { page: 'overview', slug: null };
  const [page, section] = hash.split('/').filter(Boolean);
  if (page === 'municipio' && section) return { page: 'municipio', slug: section };
  if (page === 'regioes') return { page: 'regioes', slug: null };
  return { page: 'overview', slug: null };
}

function setHashRoute(route) {
  if (route.page === 'municipio' && route.slug) {
    window.location.hash = `#/municipio/${route.slug}`;
    return;
  }
  if (route.page === 'regioes') {
    window.location.hash = '#/regioes';
    return;
  }
  window.location.hash = '#/';
}

function valueClass(classBands, value) {
  if (value == null) return 'Sem classe';
  const band = classBands.find((item) => (item.min == null || value >= item.min) && (item.max == null || value < item.max));
  return band?.label ?? 'Sem classe';
}

function flattenGeometryCoordinates(geometry, target) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') geometry.coordinates.forEach((ring) => ring.forEach((point) => target.push(point)));
  if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => ring.forEach((point) => target.push(point))));
}

function createProjector(features, width, height, padding) {
  const points = [];
  features.forEach((feature) => flattenGeometryCoordinates(feature.geometry, points));
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const scale = Math.min((width - padding * 2) / (maxLon - minLon), (height - padding * 2) / (maxLat - minLat));
  const offsetX = (width - (maxLon - minLon) * scale) / 2;
  const offsetY = (height - (maxLat - minLat) * scale) / 2;
  return ([lon, lat]) => [offsetX + (lon - minLon) * scale, height - (offsetY + (lat - minLat) * scale)];
}

function ringToPath(ring, project) {
  return `${ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ')} Z`;
}

function geometryToPath(geometry, project) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return geometry.coordinates.map((ring) => ringToPath(ring, project)).join(' ');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygon.map((ring) => ringToPath(ring, project)).join(' ')).join(' ');
  return '';
}

const IDM_CLASS_COLORS = {
  classe_1: '#1f7896',
  classe_2: '#5a97aa',
  classe_3: '#d2a56f',
  classe_4: '#b77b52',
  sem_dado: 'rgba(204, 214, 222, 0.46)',
};

function getClassBand(value) {
  if (value == null) return null;
  if (value >= 0.7) return 'classe_1';
  if (value >= 0.6) return 'classe_2';
  if (value >= 0.5) return 'classe_3';
  return 'classe_4';
}

function metricColor(value, min, max, metricKey) {
  if (value == null) return IDM_CLASS_COLORS.sem_dado;
  if (metricKey === 'idm') return IDM_CLASS_COLORS[getClassBand(value)] ?? IDM_CLASS_COLORS.sem_dado;
  const ratio = max === min ? 0.5 : (value - min) / (max - min);
  return `hsl(${196 - ratio * 22} 42% ${84 - ratio * 30}%)`;
}

function getRegionLabel(municipality) {
  return [municipality?.region?.macro, municipality?.region?.regional].filter(Boolean).join(' · ');
}

function getMunicipalityNarrative(municipality, year, dimensions) {
  if (!municipality) return 'Selecione um municipio para ver a narrativa territorial.';
  const strongest = [...dimensions]
    .map((dimension) => ({ ...dimension, value: municipality.dimensions?.[dimension.key]?.[year] ?? null }))
    .filter((dimension) => dimension.value != null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((dimension) => dimension.label.toLowerCase());
  const region = getRegionLabel(municipality);
  if (!strongest.length) return `${municipality.name} em ${region}.`;
  if (strongest.length === 1) return `${municipality.name} se destaca em ${strongest[0]}, dentro do recorte ${region}.`;
  return `${municipality.name} combina forcas em ${strongest[0]} e ${strongest[1]}, dentro do recorte ${region}.`;
}

function describeMacroCard(name, year, average, municipalities) {
  const highlights = municipalities.slice(0, 3).map((item) => item.name).join(', ');
  return {
    title: name,
    summary: MACRO_COPY[name] ?? `Media ${formatDecimal(average)} em ${year}, com protagonismo territorial no estado.`,
    footer: `${municipalities.length} municipios · ${highlights}`,
  };
}


function compactRadarLabel(label, isDimension = false) {
  if (!label) return '';
  if (isDimension) {
    const dimensionMap = {
      Ambiental: 'Amb.',
      Economia: 'Eco.',
      Social: 'Soc.',
      'Governanca Publica': 'Gov.',
      'Governan?a P?blica': 'Gov.',
    };
    return dimensionMap[label] ?? label;
  }

  const normalized = label
    .replace('Indice de ', '')
    .replace('?ndice de ', '')
    .replace('Indice do ', '')
    .replace('?ndice do ', '')
    .replace('Taxa de ', '')
    .replace('Participacao de ', '')
    .replace('Participa??o de ', '')
    .replace('Proporcao de ', '')
    .replace('Propor??o de ', '')
    .replace('Mortalidade por ', '')
    .replace('Percentual de ', '')
    .replace('Densidade de ', '')
    .replace('Numero de ', '')
    .replace('N?mero de ', '')
    .replace(' por habitante', '')
    .replace(' total', '')
    .trim();

  if (normalized.length <= 12) return normalized;
  const words = normalized.split(' ');
  if (words.length >= 2) {
    const joined = words.slice(0, 2).join(' ');
    return joined.length <= 14 ? joined : `${joined.slice(0, 13)}?`;
  }
  return `${normalized.slice(0, 13)}?`;
}

function TrendChart({ values }) {
  const width = 360;
  const height = 140;
  const paddingX = 28;
  const paddingY = 22;
  const valid = values.filter((item) => item.value != null);
  if (!valid.length) return <div className="empty-state">Sem serie historica para exibir.</div>;
  const average = valid.reduce((sum, item) => sum + item.value, 0) / valid.length;
  const points = values.map((item, index) => ({
    ...item,
    x: paddingX + (index * (width - paddingX * 2)) / Math.max(values.length - 1, 1),
    y: height - paddingY - ((item.value ?? 0) * (height - paddingY * 2)),
  }));
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const averageY = height - paddingY - (average * (height - paddingY * 2));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart" role="img" aria-label="Serie historica do indicador">
      <defs>
        <linearGradient id="historyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#2c7da0" />
          <stop offset="100%" stopColor="#d4a373" />
        </linearGradient>
      </defs>
      <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} className="chart-axis" />
      <line x1={paddingX} y1={averageY} x2={width - paddingX} y2={averageY} className="chart-average-line" />
      <path d={path} className="chart-line" stroke="url(#historyGradient)" />
      {points.map((point) => (
        <g key={point.label}>
          <circle cx={point.x} cy={point.y} r="4.5" className="chart-dot" />
          <text x={point.x} y={height - 4} textAnchor="middle" className="chart-label">{point.label}</text>
          <text x={point.x} y={point.y - 10} textAnchor="middle" className="chart-value-label">{point.value == null ? '' : formatDecimal(point.value)}</text>
        </g>
      ))}
    </svg>
  );
}
function ComparisonRadarPanel({ first, second, items, activeKey, activeDimension, onSelectItem }) {
  const size = 280;
  const center = size / 2;
  const radius = 86;
  const levels = [0.25, 0.5, 0.75, 1];
  const angleStep = (Math.PI * 2) / Math.max(items.length, 1);

  const pointsFor = (sourceKey) => items.map((item, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const value = item[sourceKey] ?? 0;
    return {
      ...item,
      angle,
      value,
      x: center + Math.cos(angle) * radius * value,
      y: center + Math.sin(angle) * radius * value,
      buttonX: center + Math.cos(angle) * (radius + 32),
      buttonY: center + Math.sin(angle) * (radius + 32),
    };
  });

  const leftPoints = pointsFor('valueLeft');
  const rightPoints = pointsFor('valueRight');
  const polygon = (points) => points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const strongestDiffs = items;

  return (
    <section className="panel comparison-hero panel-soft-glow">
      <div className="section-head comparison-heading">
        <div>
          <span className="eyebrow">Radar territorial</span>
          <h2>Forcas comparadas por dimensao</h2>
        </div>
      </div>

      <div className="comparison-hero-grid">
        <div className="comparison-radar-shell">
          <div className="comparison-legend comparison-legend-near">
            <span><i className="legend-dot left" />{first?.name ?? 'Municipio A'}</span>
            <span><i className="legend-dot right" />{second?.name ?? 'Municipio B'}</span>
          </div>
          <div className="comparison-radar-stage">
            <svg viewBox={`0 0 ${size} ${size}`} className="radar-svg comparison-radar" role="img" aria-label="Comparacao territorial">
              {levels.map((level) => (
                <polygon
                  key={level}
                  points={leftPoints.map((point) => `${(center + Math.cos(point.angle) * radius * level).toFixed(2)},${(center + Math.sin(point.angle) * radius * level).toFixed(2)}`).join(' ')}
                  className="radar-grid"
                />
              ))}
              {leftPoints.map((point) => (
                <line key={point.key} x1={center} y1={center} x2={center + Math.cos(point.angle) * radius} y2={center + Math.sin(point.angle) * radius} className="radar-axis" />
              ))}
              <polygon points={polygon(leftPoints)} className="radar-shape radar-teal" />
              <polygon points={polygon(rightPoints)} className="radar-shape radar-warm" />
            </svg>
            {leftPoints.map((point) => (
              <button
                key={point.key}
                type="button"
                className={`radar-pivot ${activeKey === point.key ? 'active' : ''}`}
                style={{ left: `${(point.buttonX / size) * 100}%`, top: `${(point.buttonY / size) * 100}%` }}
                onClick={() => onSelectItem(point)}
              >
                {point.shortLabel}
              </button>
            ))}
          </div>
        </div>

        <div className="comparison-detail-stack">
          <article className="active-dimension-card">
            <div>
              <span className="eyebrow">Dimensao ativa</span>
              <h3>{activeDimension?.label ?? 'Comparacao geral'}</h3>
              <p>{activeDimension?.description ?? 'Clique em uma dimensao no radar para aprofundar nos indicadores internos.'}</p>
            </div>
            <span className="detail-chip">Clique no radar</span>
          </article>

          <div className="indicator-compare-grid">
            {strongestDiffs.map((item) => {
              const delta = (item.valueLeft ?? 0) - (item.valueRight ?? 0);
              return (
                <article key={item.key} className="indicator-compare-card">
                  <div className="indicator-compare-top">
                    <div>
                      <strong>{item.label}</strong>
                      <span>Indicador interno</span>
                    </div>
                    <b>{delta >= 0 ? '+' : ''}{formatDecimal(delta, 3)}</b>
                  </div>
                  <div className="indicator-compare-values">
                    <div className="value-pill teal">
                      <span>{first?.name ?? 'Municipio A'}</span>
                      <strong>{formatDecimal(item.valueLeft)}</strong>
                    </div>
                    <div className="value-pill warm">
                      <span>{second?.name ?? 'Municipio B'}</span>
                      <strong>{formatDecimal(item.valueRight)}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function ChoroplethMap({ features, municipalitiesBySlug, year, metricKey, metricLabel, selectedSlug, onSelect, classBands }) {
  const [hovered, setHovered] = useState(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0 });
  const width = 700;
  const height = 720;

  const enriched = useMemo(() => {
    const rows = features.map((feature) => {
      const slug = slugify(feature.properties?.name || '');
      const municipality = municipalitiesBySlug[slug];
      return { feature, municipality, slug, value: municipality ? getMetricValue(municipality, year, metricKey) : null };
    }).filter((item) => item.municipality);
    const values = rows.map((item) => item.value).filter((value) => value != null);
    const ranked = [...rows].filter((item) => item.value != null).sort((a, b) => b.value - a.value);
    const rankBySlug = Object.fromEntries(ranked.map((item, index) => [item.slug, index + 1]));
    return {
      rows,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
      rankBySlug,
      project: createProjector(rows.map((item) => item.feature), width, height, 20),
    };
  }, [features, municipalitiesBySlug, year, metricKey]);

  const active = hovered ?? enriched.rows.find((item) => item.slug === selectedSlug) ?? null;

  return (
    <div className="map-shell">
      <div className="map-header">
        <div>
          <span className="eyebrow">Mapa coropletico</span>
          <h2>Pernambuco como interface principal</h2>
        </div>
        <div className="map-badge">184 municipios</div>
      </div>
      <p className="map-intro">Passe o mouse para descobrir sinais territoriais e clique para abrir o dossie municipal.</p>
      <div className="map-frame">
        <svg viewBox={`0 0 ${width} ${height}`} className="map-svg" role="img" aria-label="Mapa dos municipios de Pernambuco">
          <defs>
            <radialGradient id="mapAura" cx="40%" cy="40%" r="70%">
              <stop offset="0%" stopColor="rgba(190, 227, 243, 0.85)" />
              <stop offset="65%" stopColor="rgba(232, 241, 245, 0.68)" />
              <stop offset="100%" stopColor="rgba(232, 205, 176, 0.38)" />
            </radialGradient>
          </defs>
          <ellipse cx="330" cy="385" rx="275" ry="210" fill="url(#mapAura)" />
          {enriched.rows.map((item) => {
            const isSelected = item.slug === selectedSlug;
            const isHovered = hovered?.slug === item.slug;
            return (
              <path
                key={item.slug}
                d={geometryToPath(item.feature.geometry, enriched.project)}
                fill={metricColor(item.value, enriched.min, enriched.max, metricKey)}
                stroke={isSelected || isHovered ? '#d69a57' : 'rgba(255,255,255,0.92)'}
                strokeWidth={isSelected || isHovered ? 2.2 : 0.95}
                className={`map-path ${isHovered ? 'hovered' : ''}`}
                onMouseEnter={(event) => { setHovered(item); setTooltip({ x: event.clientX, y: event.clientY }); }}
                onMouseMove={(event) => setTooltip({ x: event.clientX, y: event.clientY })}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(item.slug)}
              />
            );
          })}
        </svg>
      </div>

      <div className="map-footer-row">
        <div className="map-legend">
          {metricKey === 'idm'
            ? classBands.map((band) => (
              <span key={band.key} className="legend-band"><i className="legend-swatch" style={{ background: IDM_CLASS_COLORS[band.key] }} />{band.label}</span>
            ))
            : <><span>Menor</span><div className="legend-gradient" /><span>Maior</span></>}
        </div>
        <div className="map-caption">
          <strong>{active?.municipality?.name ?? 'Exploracao livre'}</strong>
          <span>{active ? `${metricLabel} ${year}: ${formatDecimal(active.value)}` : 'Passe o mouse para ver informacoes territoriais.'}</span>
        </div>
      </div>

      {hovered ? (
        <div className="map-floating-tooltip" style={{ left: tooltip.x + 16, top: tooltip.y + 16 }}>
          <div className="map-hover-card">
            <strong>{hovered.municipality.name}</strong>
            <span>{metricLabel} {year}: {formatDecimal(hovered.value)}</span>
            <span>IDM {year}: {formatDecimal(hovered.municipality.idm?.[year])} · {valueClass(classBands, hovered.municipality.idm?.[year])}</span>
            <span>Rank #{enriched.rankBySlug[hovered.slug] ?? 'N/D'} · {getRegionLabel(hovered.municipality)}</span>
            <span>Ambiental {formatDecimal(hovered.municipality.dimensions?.ambiental?.[year])} · Economia {formatDecimal(hovered.municipality.dimensions?.economia?.[year])}</span>
            <span>Social {formatDecimal(hovered.municipality.dimensions?.social?.[year])} · Governanca {formatDecimal(hovered.municipality.dimensions?.governanca?.[year])}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
function ComparisonCard({ municipality, year, dimensions }) {
  if (!municipality) return <div className="comparison-card empty-state">Selecione um municipio.</div>;
  return (
    <article className="comparison-card">
      <div className="comparison-topline">
        <div>
          <span className="eyebrow">Municipio</span>
          <h3>{municipality.name}</h3>
        </div>
        <strong>{formatDecimal(municipality.idm?.[year])}</strong>
      </div>
      <p className="panel-copy">{getRegionLabel(municipality)}</p>
      <TrendChart values={Object.keys(municipality.idm).map((item) => ({ label: item, value: municipality.idm[item] }))} />
      <div className="dimension-grid compact">
        {dimensions.map((dimension) => (
          <div key={dimension.key} className="mini-stat">
            <span>{dimension.label}</span>
            <strong>{formatDecimal(municipality.dimensions?.[dimension.key]?.[year])}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function RegionPanel({ dataset, selectedYear, municipalities, metricKey }) {
  const macros = Object.entries(dataset.regionSummary.macro)
    .map(([name, values]) => ({
      name,
      value: values[selectedYear],
      municipalities: municipalities
        .filter((municipality) => municipality.region?.macro === name)
        .sort((a, b) => (getMetricValue(b, selectedYear, metricKey) ?? -1) - (getMetricValue(a, selectedYear, metricKey) ?? -1)),
    }))
    .sort((a, b) => b.value - a.value);

  const regionais = Object.entries(dataset.regionSummary.regional)
    .map(([name, values]) => ({ name, value: values[selectedYear] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  return (
    <section className="region-panel-stack">
      <section className="panel panel-soft-glow region-highlight-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Secao regional</span>
            <h2>Macro-regioes e regionais de desenvolvimento</h2>
          </div>
          <p>Medias do IDM por agrupamento territorial em {selectedYear}.</p>
        </div>
        <div className="region-highlight-grid">
          {macros.map((macro) => {
            const card = describeMacroCard(macro.name, selectedYear, macro.value, macro.municipalities);
            return (
              <article key={macro.name} className={`region-highlight-card ${macros[0]?.name === macro.name ? 'active' : ''}`}>
                <span className="eyebrow">Macro-regiao</span>
                <h3>{card.title}</h3>
                <p>{card.summary}</p>
                <div className="region-highlight-footer">
                  <span>{card.footer}</span>
                  <strong>{formatDecimal(macro.value)}</strong>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="region-grid">
        <article className="panel detail-block">
          <div className="section-head small-gap">
            <div>
              <span className="eyebrow">Macro-regioes</span>
              <h3>Media por recorte</h3>
            </div>
          </div>
          <div className="ranking-table">
            {macros.map((item, index) => (
              <div key={item.name} className="ranking-row static-row">
                <span>#{index + 1}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.municipalities.length} municipios</small>
                </div>
                <span>{formatDecimal(item.value)}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel detail-block">
          <div className="section-head small-gap">
            <div>
              <span className="eyebrow">Regionais</span>
              <h3>Destaques internos</h3>
            </div>
          </div>
          <div className="ranking-table">
            {regionais.map((item, index) => (
              <div key={item.name} className="ranking-row static-row">
                <span>#{index + 1}</span>
                <strong>{item.name}</strong>
                <span>{formatDecimal(item.value)}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}

function MunicipalityPage({ dataset, municipality, selectedYear, focusDimension, setFocusDimension, metricTrend, topMunicipalities }) {
  const dimensionMap = Object.fromEntries(dataset.dimensions.map((dimension) => [dimension.key, dimension]));
  const focusIndicators = dataset.indicatorMetadata
    .filter((indicator) => indicator.dimension === focusDimension)
    .map((indicator) => ({ ...indicator, value: municipality.indicators?.[selectedYear]?.[indicator.key] ?? null }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

  return (
    <section className="municipality-page-stack">
      <section className="panel municipality-hero panel-soft-glow">
        <div className="section-head municipality-hero-head">
          <div>
            <span className="eyebrow">Drill-down municipal</span>
            <h2>{municipality.name}</h2>
            <p>{getMunicipalityNarrative(municipality, selectedYear, dataset.dimensions)}</p>
          </div>
          <div className="municipality-chip-row">
            {topMunicipalities.map((item) => (
              <button
                key={item.slug}
                type="button"
                className={`municipality-chip ${item.slug === municipality.slug ? 'active' : ''}`}
                onClick={() => setHashRoute({ page: 'municipio', slug: item.slug })}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>

        <div className="dimension-card-grid feature-grid">
          {dataset.dimensions.map((dimension) => {
            const value = municipality.dimensions?.[dimension.key]?.[selectedYear] ?? null;
            return (
              <button
                key={dimension.key}
                type="button"
                className={`dimension-feature ${focusDimension === dimension.key ? 'active' : ''}`}
                onClick={() => setFocusDimension(dimension.key)}
              >
                <span>{dimension.label.slice(0, 3).toUpperCase()}</span>
                <h3>{dimension.label}</h3>
                <strong>{value == null ? 'Sem dado' : (value * 100).toFixed(1)}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <section className="municipality-detail-grid">
        <article className="panel detail-block">
          <span className="eyebrow">Serie historica</span>
          <h3>Evolucao do IDM-PE</h3>
          <TrendChart values={metricTrend} />
        </article>

        <article className="panel detail-block">
          <div className="subsection-head">
            <div>
              <span className="eyebrow">Dimensao ativa</span>
              <h3>{dimensionMap[focusDimension]?.label}</h3>
              <p>{dimensionMap[focusDimension]?.description}</p>
            </div>
            <div className="detail-badge slim">{formatDecimal(municipality.dimensions?.[focusDimension]?.[selectedYear])}</div>
          </div>
          <div className="indicator-spotlight-list">
            {focusIndicators.slice(0, 6).map((indicator) => (
              <article key={indicator.key} className="indicator-spotlight-card">
                <div className="indicator-spotlight-top">
                  <div>
                    <strong>{indicator.label}</strong>
                    <span>{indicator.polarity === 'positive' ? 'Tendencia positiva' : 'Tendencia negativa'}</span>
                  </div>
                  <b>{formatDecimal(indicator.value)}</b>
                </div>
                <p>{indicator.description}</p>
                <div className="indicator-bar"><span style={{ width: `${Math.max(0, Math.min(100, (indicator.value ?? 0) * 100))}%` }} /></div>
              </article>
            ))}
          </div>
        </article>
      </section>
    </section>
  );
}
function App() {
  const [route, setRoute] = useState(getRouteFromHash());
  const latestYear = String(dataset.years.at(-1));
  const [selectedYear, setSelectedYear] = useState(latestYear);
  const [metricKey, setMetricKey] = useState('idm');
  const [selectedSlug, setSelectedSlug] = useState(getRouteFromHash().slug || slugify(dataset.summary.years[latestYear].top.name));
  const [focusDimension, setFocusDimension] = useState('economia');
  const [leftComparison, setLeftComparison] = useState('recife');
  const [rightComparison, setRightComparison] = useState('petrolina');
  const [comparisonDrill, setComparisonDrill] = useState(null);
  const [overviewTab, setOverviewTab] = useState('atlas');

  useEffect(() => {
    const syncRoute = () => setRoute(getRouteFromHash());
    window.addEventListener('hashchange', syncRoute);
    syncRoute();
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  const model = useMemo(() => {
    const metricOptions = [
      { key: 'idm', label: 'IDM-PE', dimension: null },
      ...dataset.dimensions.map((dimension) => ({ key: `dimension:${dimension.key}`, label: dimension.label, dimension: dimension.key })),
      ...dataset.indicatorMetadata.map((indicator) => ({ key: `indicator:${indicator.key}`, label: indicator.label, dimension: indicator.dimension })),
    ];
    return {
      municipalities: dataset.municipalities,
      municipalitiesBySlug: Object.fromEntries(dataset.municipalities.map((municipality) => [municipality.slug, municipality])),
      yearStrings: dataset.years.map(String),
      metricMap: Object.fromEntries(metricOptions.map((metric) => [metric.key, metric])),
      dimensionMap: Object.fromEntries(dataset.dimensions.map((dimension) => [dimension.key, dimension])),
    };
  }, []);

  useEffect(() => {
    if (route.page === 'municipio' && route.slug && model.municipalitiesBySlug[route.slug]) setSelectedSlug(route.slug);
  }, [route, model]);

  const selectedMunicipality = model.municipalitiesBySlug[selectedSlug] ?? model.municipalities[0];
  const leftMunicipality = model.municipalitiesBySlug[leftComparison] ?? null;
  const rightMunicipality = model.municipalitiesBySlug[rightComparison] ?? null;
  const selectedMetric = model.metricMap[metricKey] ?? { label: 'IDM-PE' };

  const yearlyRows = useMemo(() => {
    const rows = model.municipalities
      .map((municipality) => ({ municipality, value: getMetricValue(municipality, selectedYear, metricKey) }))
      .filter((item) => item.value != null)
      .sort((a, b) => b.value - a.value);
    return { all: rows, filtered: rows };
  }, [model, selectedYear, metricKey]);

  const selectedRank = useMemo(() => yearlyRows.all.findIndex((item) => item.municipality.slug === selectedMunicipality.slug) + 1, [selectedMunicipality, yearlyRows]);

  const overview = useMemo(() => {
    const summaryForYear = dataset.summary.years[selectedYear];
    const average = yearlyRows.all.reduce((accumulator, item) => accumulator + item.value, 0) / Math.max(yearlyRows.all.length, 1);
    const previousYear = String(Number(selectedYear) - 1);
    const deltas = model.municipalities
      .map((municipality) => {
        const current = getMetricValue(municipality, selectedYear, metricKey);
        const previous = getMetricValue(municipality, previousYear, metricKey);
        return current == null || previous == null ? null : { municipality, delta: current - previous };
      })
      .filter(Boolean)
      .sort((a, b) => b.delta - a.delta);
    return { average, top: yearlyRows.all[0] ?? null, classCounts: summaryForYear.classCounts, biggestClimb: deltas[0] ?? null };
  }, [selectedYear, metricKey, yearlyRows, model]);

  const focusDimensionCards = useMemo(() => dataset.dimensions.map((dimension) => ({ ...dimension, value: selectedMunicipality.dimensions?.[dimension.key]?.[selectedYear] ?? null })), [selectedMunicipality, selectedYear]);

  const comparisonItems = useMemo(() => {
    if (!comparisonDrill) {
      return dataset.dimensions.map((dimension) => ({
        key: dimension.key,
        shortLabel: compactRadarLabel(dimension.label, true),
        label: dimension.label,
        description: dimension.description,
        valueLeft: leftMunicipality?.dimensions?.[dimension.key]?.[selectedYear] ?? null,
        valueRight: rightMunicipality?.dimensions?.[dimension.key]?.[selectedYear] ?? null,
      }));
    }
    return dataset.indicatorMetadata
      .filter((indicator) => indicator.dimension === comparisonDrill)
      .map((indicator) => ({
        key: indicator.key,
        shortLabel: compactRadarLabel(indicator.label),
        label: indicator.label,
        description: indicator.description,
        valueLeft: leftMunicipality?.indicators?.[selectedYear]?.[indicator.key] ?? null,
        valueRight: rightMunicipality?.indicators?.[selectedYear]?.[indicator.key] ?? null,
      }))
      .sort((a, b) => Math.abs((b.valueLeft ?? 0) - (b.valueRight ?? 0)) - Math.abs((a.valueLeft ?? 0) - (a.valueRight ?? 0)));
  }, [comparisonDrill, leftMunicipality, rightMunicipality, selectedYear]);

  const topMunicipalities = yearlyRows.all.slice(0, 8).map((item) => item.municipality);

  function handleMetricChange(nextMetricKey) {
    startTransition(() => {
      setMetricKey(nextMetricKey);
      const metric = model.metricMap[nextMetricKey];
      if (metric.dimension) setFocusDimension(metric.dimension);
    });
  }

  function handleMunicipalityFocus(slug) {
    setSelectedSlug(slug);
  }

  function handleMunicipalitySelect(slug) {
    setSelectedSlug(slug);
    setHashRoute({ page: 'municipio', slug });
  }

  function handleComparisonItemClick(item) {
    if (!comparisonDrill && dataset.dimensions.some((dimension) => dimension.key === item.key)) {
      setComparisonDrill(item.key);
      return;
    }
    if (comparisonDrill && item.key === comparisonDrill) setComparisonDrill(null);
  }

  const tabItems = [
    { key: 'atlas', label: 'Atlas', subtitle: 'Panorama estadual' },
    { key: 'municipio', label: 'Municipio', subtitle: 'Drill-down territorial' },
    { key: 'comparacao', label: 'Comparacao', subtitle: 'Analise lado a lado' },
  ];

  return (
    <div className="app-shell">
      <header className="hero hero-shell panel panel-soft-glow">
        <div className="hero-topline">
          <div className="hero-copy">
            <span className="eyebrow">Atlas interativo de dados publicos</span>
            <h1>IDM-PE · Centro de inteligencia territorial</h1>
            <p>Visual mais humano e navegavel para explorar desenvolvimento municipal em Pernambuco com clareza estrategica.</p>
          </div>
          <button type="button" className="hero-cta" onClick={() => { setHashRoute({ page: 'overview' }); setOverviewTab('atlas'); }}>Explorar atlas</button>
        </div>

        <section className="toolbar hero-toolbar">
          <label>
            <span className="eyebrow">Ano</span>
            <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
              {model.yearStrings.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label>
            <span className="eyebrow">Visao</span>
            <select value={metricKey} onChange={(event) => handleMetricChange(event.target.value)}>
              <optgroup label="Sintese"><option value="idm">IDM-PE</option></optgroup>
              <optgroup label="Dimensoes">{dataset.dimensions.map((dimension) => <option key={dimension.key} value={`dimension:${dimension.key}`}>{dimension.label}</option>)}</optgroup>
              <optgroup label="Indicadores">{dataset.indicatorMetadata.map((indicator) => <option key={indicator.key} value={`indicator:${indicator.key}`}>{indicator.label}</option>)}</optgroup>
            </select>
          </label>
          <label>
            <span className="eyebrow">Municipio em foco</span>
            <select value={selectedMunicipality.slug} onChange={(event) => handleMunicipalityFocus(event.target.value)}>
              {model.municipalities.map((municipality) => <option key={municipality.slug} value={municipality.slug}>{municipality.name}</option>)}
            </select>
          </label>
        </section>
      </header>

      <section className="route-strip panel">
        <button type="button" className={route.page === 'overview' ? 'nav-chip active' : 'nav-chip'} onClick={() => setHashRoute({ page: 'overview' })}>Visao geral</button>
        <button type="button" className={route.page === 'regioes' ? 'nav-chip active' : 'nav-chip'} onClick={() => setHashRoute({ page: 'regioes' })}>Regioes</button>
        <button type="button" className={route.page === 'municipio' ? 'nav-chip active' : 'nav-chip'} onClick={() => setHashRoute({ page: 'municipio', slug: selectedMunicipality.slug })}>Pagina do municipio</button>
      </section>
      {route.page === 'overview' ? (
        <section className="overview-stage">
          <div className="workspace-tabs panel">
            {tabItems.map((tab) => (
              <button key={tab.key} type="button" className={overviewTab === tab.key ? 'workspace-tab active' : 'workspace-tab'} onClick={() => setOverviewTab(tab.key)}>
                <strong>{tab.label}</strong>
                <span>{tab.subtitle}</span>
              </button>
            ))}
          </div>

          <section className="overview-grid stat-ribbon">
            <article className="stat-card panel highlight">
              <span className="eyebrow">Lider no recorte</span>
              <h2>{overview.top?.municipality.name}</h2>
              <strong>{formatDecimal(overview.top?.value)}</strong>
              <p>Melhor desempenho em {selectedMetric.label} no ano de {selectedYear}.</p>
            </article>
            <article className="stat-card panel">
              <span className="eyebrow">Media estadual</span>
              <h2>{formatDecimal(overview.average)}</h2>
              <p>Referencia para comparar municipios no mesmo recorte temporal.</p>
            </article>
            <article className="stat-card panel">
              <span className="eyebrow">Maior subida anual</span>
              <h2>{overview.biggestClimb?.municipality.name ?? 'Sem base'}</h2>
              <strong>{formatDelta(overview.biggestClimb?.delta ?? null)}</strong>
              <p>Variacao contra {Number(selectedYear) - 1} na visao atual.</p>
            </article>
            <article className="stat-card panel">
              <span className="eyebrow">Classes do IDM</span>
              <div className="class-list class-totals">
                {dataset.classBands.map((band) => (
                  <div key={band.key} className="class-pill">
                    <span>{band.label}</span>
                    <strong>{overview.classCounts?.[band.key] ?? 0}</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>

          {overviewTab === 'atlas' ? (
            <>
              <section className="content-grid atlas-grid">
                <article className="panel map-panel panel-soft-glow">
                  <ChoroplethMap
                    features={geojson.features}
                    municipalitiesBySlug={model.municipalitiesBySlug}
                    year={selectedYear}
                    metricKey={metricKey}
                    metricLabel={selectedMetric.label}
                    selectedSlug={selectedMunicipality.slug}
                    onSelect={handleMunicipalityFocus}
                    classBands={dataset.classBands}
                  />
                </article>

                <div className="right-column atlas-side-stack">
                  <article className="panel focus-panel">
                    <div className="section-head">
                      <div>
                        <span className="eyebrow">Municipio em foco</span>
                        <h2>{selectedMunicipality.name}</h2>
                      </div>
                      <div className="rank-badge">#{selectedRank}</div>
                    </div>
                    <p className="panel-copy">{getMunicipalityNarrative(selectedMunicipality, selectedYear, dataset.dimensions)}</p>
                    <div className="focus-stats-grid">
                      <div className="focus-stat"><span>IDM-PE {selectedYear}</span><strong>{formatDecimal(selectedMunicipality.idm?.[selectedYear])}</strong></div>
                      <div className="focus-stat"><span>Classe</span><strong>{valueClass(dataset.classBands, selectedMunicipality.idm?.[selectedYear])}</strong></div>
                    </div>
                    <div className="focus-region-row">
                      <div>
                        <span>Regiao</span>
                        <strong>{getRegionLabel(selectedMunicipality)}</strong>
                      </div>
                      <button type="button" className="secondary-action" onClick={() => setHashRoute({ page: 'municipio', slug: selectedMunicipality.slug })}>Drill-down</button>
                    </div>
                  </article>

                  <article className="panel ranking-panel ranking-clean-panel">
                    <div className="section-head ranking-clean-head">
                      <div>
                        <span className="eyebrow">Ranking de municipios</span>
                        <h2>Top desempenho</h2>
                      </div>
                      <div className="filter-dot" />
                    </div>
                    <div className="ranking-clean-list">
                      {yearlyRows.filtered.slice(0, 8).map((item, index) => (
                        <button
                          key={item.municipality.slug}
                          type="button"
                          className={`ranking-clean-row ${item.municipality.slug === selectedMunicipality.slug ? 'active' : ''}`}
                          onClick={() => setSelectedSlug(item.municipality.slug)}
                        >
                          <span className="ranking-clean-index">{index + 1}</span>
                          <div className="ranking-clean-copy">
                            <strong>{item.municipality.name}</strong>
                            <small>{getRegionLabel(item.municipality)}</small>
                          </div>
                          <b className="ranking-clean-score">{formatDecimal(item.value)}</b>
                        </button>
                      ))}
                    </div>
                  </article>
                </div>
              </section>

              <RegionPanel dataset={dataset} selectedYear={selectedYear} municipalities={model.municipalities} metricKey={metricKey} />
            </>
          ) : null}

          {overviewTab === 'municipio' ? (
            <MunicipalityPage
              dataset={dataset}
              municipality={selectedMunicipality}
              selectedYear={selectedYear}
              focusDimension={focusDimension}
              setFocusDimension={setFocusDimension}
              metricTrend={model.yearStrings.map((year) => ({ label: year, value: selectedMunicipality.idm?.[year] ?? null }))}
              topMunicipalities={topMunicipalities}
            />
          ) : null}

          {overviewTab === 'comparacao' ? (
            <section className="comparison-page-stack">
              <section className="comparison-controls-shell panel">
                <div className="comparison-controls two-up">
                  <label>
                    <span className="eyebrow">Municipio A</span>
                    <select value={leftComparison} onChange={(event) => setLeftComparison(event.target.value)}>
                      {model.municipalities.map((municipality) => <option key={municipality.slug} value={municipality.slug}>{municipality.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="eyebrow">Municipio B</span>
                    <select value={rightComparison} onChange={(event) => setRightComparison(event.target.value)}>
                      {model.municipalities.map((municipality) => <option key={municipality.slug} value={municipality.slug}>{municipality.name}</option>)}
                    </select>
                  </label>
                </div>
              </section>

              <ComparisonRadarPanel
                first={leftMunicipality}
                second={rightMunicipality}
                items={comparisonItems}
                activeKey={comparisonDrill}
                activeDimension={comparisonDrill ? model.dimensionMap[comparisonDrill] : dataset.dimensions[0]}
                onSelectItem={handleComparisonItemClick}
              />

              <div className="comparison-header-actions">
                {comparisonDrill ? <button type="button" className="secondary-action" onClick={() => setComparisonDrill(null)}>Voltar para dimensoes</button> : null}
              </div>

              <div className="comparison-grid two-up">
                <ComparisonCard municipality={leftMunicipality} year={selectedYear} dimensions={dataset.dimensions} />
                <ComparisonCard municipality={rightMunicipality} year={selectedYear} dimensions={dataset.dimensions} />
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      {route.page === 'municipio' ? (
        <MunicipalityPage
          dataset={dataset}
          municipality={selectedMunicipality}
          selectedYear={selectedYear}
          focusDimension={focusDimension}
          setFocusDimension={setFocusDimension}
          metricTrend={model.yearStrings.map((year) => ({ label: year, value: selectedMunicipality.idm?.[year] ?? null }))}
          topMunicipalities={topMunicipalities}
        />
      ) : null}

      {route.page === 'regioes' ? (
        <RegionPanel dataset={dataset} selectedYear={selectedYear} municipalities={model.municipalities} metricKey={metricKey} />
      ) : null}
    </div>
  );
}

export default App;
