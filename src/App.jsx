import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import dataset from './data/idmDataset.json';
import geojson from './data/peMunicipios.json';

const MUNICIPALITY_ALIASES = {
  'belem de sao francisco': 'belem do sao francisco',
  iguaraci: 'iguaracy',
  'lagoa do itaenga': 'lagoa de itaenga',
  'sao caitano': 'sao caetano',
};

const MACRO_COPY = {
  Metropolitana: 'Maior densidade institucional e economica, concentrando servicos, infraestrutura e articulacao urbana.',
  Agreste: 'Rede interiorizada com cidades medias, comercio regional e forte papel de conexao entre litoral e sertao.',
  'Sertão Pernambucano': 'Territorio amplo, com pressao climatica maior e trajetorias dependentes de capacidade publica e logistica.',
  'Vale São Francisco/Araripe': 'Faixa produtiva com irrigacao, energia, exportacao e polos urbanos especializados.',
};

const MUNICIPALITY_REGION_FALLBACKS = {
  'sao caetano': {
    macro: 'Agreste',
    regional: 'AGRESTE CENTRAL',
  },
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

function formatPercent(value, digits = 1) {
  return value == null ? 'Sem dado' : `${(value * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function formatPercentDelta(value) {
  if (value == null) return 'Sem base';
  return `${value >= 0 ? '+' : ''}${(value * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`;
}

function formatIndexDelta(value) {
  if (value == null) return 'Sem base';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

function slugify(value) {
  const base = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['-]/g, ' ').replace(/\s+/g, ' ').trim();
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
  if (route.page === 'municipio' && route.slug) return void (window.location.hash = `#/municipio/${route.slug}`);
  if (route.page === 'regioes') return void (window.location.hash = '#/regioes');
  window.location.hash = '#/';
}

function valueClass(classBands, value) {
  if (value == null) return 'Sem classe';
  const band = classBands.find((item) => (item.min == null || value >= item.min) && (item.max == null || value < item.max));
  return band?.label ?? 'Sem classe';
}

function shortClassDescription(band) {
  if (!band) return '';
  if (band.min != null && band.max == null) return `>= ${formatDecimal(band.min)}`;
  if (band.min != null && band.max != null) return `${formatDecimal(band.min)} a ${formatDecimal(band.max)}`;
  if (band.min == null && band.max != null) return `< ${formatDecimal(band.max)}`;
  return band.description ?? '';
}

function flattenGeometryCoordinates(geometry, target) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') geometry.coordinates.forEach((ring) => ring.forEach((point) => target.push(point)));
  if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => ring.forEach((point) => target.push(point))));
}

function createProjector(features, width, height, padding, verticalAlign = 'center') {
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
  const projectedHeight = (maxLat - minLat) * scale;
  const offsetY = verticalAlign === 'top' ? height - projectedHeight - padding : (height - projectedHeight) / 2;
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
  classe_1: '#235a7d',
  classe_2: '#5f97b4',
  classe_3: '#c69254',
  classe_4: '#b66f4b',
  sem_dado: '#cfd8df',
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
  return `hsl(${205 - ratio * 20} 44% ${80 - ratio * 24}%)`;
}

function compactRadarLabel(label, isDimension = false) {
  if (!label) return '';
  if (isDimension) return ({ Ambiental: 'Ambiental', Economia: 'Economia', Social: 'Social', 'Governanca Publica': 'Governanca', 'Governan?a P?blica': 'Governanca' }[label] ?? label);
  const normalized = label.replace('Indice de ', '').replace('?ndice de ', '').replace('Indice do ', '').replace('?ndice do ', '').replace('Taxa de ', '').replace('Participacao de ', '').replace('Participa??o de ', '').replace('Proporcao de ', '').replace('Propor??o de ', '').replace('Mortalidade por ', '').replace('Percentual de ', '').replace('Densidade de ', '').replace('Numero de ', '').replace('N?mero de ', '').replace(' por habitante', '').replace(' total', '').trim();
  if (normalized.length <= 16) return normalized;
  return normalized.split(' ').slice(0, 2).join(' ');
}

function getRegionLabel(municipality) {
  const region = municipality?.region && Object.keys(municipality.region).length ? municipality.region : MUNICIPALITY_REGION_FALLBACKS[municipality?.slug];
  return [region?.macro, region?.regional].filter(Boolean).join(' · ');
}

function getMunicipalityRegion(municipality) {
  if (!municipality) return null;
  if (municipality.region && Object.keys(municipality.region).length) return municipality.region;
  return MUNICIPALITY_REGION_FALLBACKS[municipality.slug] ?? null;
}

function getMunicipalityNarrative(municipality, year, dimensions) {
  if (!municipality) return 'Selecione um municipio para ver a narrativa territorial.';
  const strongest = [...dimensions].map((dimension) => ({ ...dimension, value: municipality.dimensions?.[dimension.key]?.[year] ?? null })).filter((dimension) => dimension.value != null).sort((a, b) => b.value - a.value).slice(0, 2).map((dimension) => dimension.label.toLowerCase());
  const region = getRegionLabel(municipality);
  if (!strongest.length) return `${municipality.name} em ${region}.`;
  if (strongest.length === 1) return `${municipality.name} se destaca em ${strongest[0]}, dentro do recorte ${region}.`;
  return `${municipality.name} combina forcas em ${strongest[0]} e ${strongest[1]}, dentro do recorte ${region}.`;
}

function TrendChart({ values }) {
  const width = 360;
  const height = 144;
  const paddingX = 22;
  const paddingY = 20;
  const valid = values.filter((item) => item.value != null);
  if (!valid.length) return <div className="empty-state">Sem serie historica para exibir.</div>;
  const average = valid.reduce((sum, item) => sum + item.value, 0) / valid.length;
  const points = values.map((item, index) => ({ ...item, x: paddingX + (index * (width - paddingX * 2)) / Math.max(values.length - 1, 1), y: height - paddingY - ((item.value ?? 0) * (height - paddingY * 2)) }));
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const averageY = height - paddingY - (average * (height - paddingY * 2));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trend-chart" role="img" aria-label="Serie historica do indicador">
      <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} className="chart-axis" />
      <line x1={paddingX} y1={averageY} x2={width - paddingX} y2={averageY} className="chart-average-line" />
      <path d={path} className="chart-line" />
      {points.map((point) => <g key={point.label}><circle cx={point.x} cy={point.y} r="3.8" className="chart-dot" /><text x={point.x} y={height - 4} textAnchor="middle" className="chart-label">{point.label}</text></g>)}
    </svg>
  );
}

function RadarChart({ title, municipality, items, tone = 'blue' }) {
  const size = 290;
  const center = size / 2;
  const radius = 92;
  const levels = [0.25, 0.5, 0.75, 1];
  const safeItems = items.slice(0, 8);
  const angleStep = (Math.PI * 2) / Math.max(safeItems.length, 1);
  const points = safeItems.map((item, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const value = Math.max(0, Math.min(1, item.value ?? 0));
    return { ...item, angle, value, x: center + Math.cos(angle) * radius * value, y: center + Math.sin(angle) * radius * value, labelX: center + Math.cos(angle) * (radius + 24), labelY: center + Math.sin(angle) * (radius + 24) };
  });
  return (
    <article className="radar-card">
      <div className="radar-card-head">
        <div><span className="eyebrow">Radar</span><h3>{title}</h3></div>
        <div className="mini-idm"><span>IDM</span><strong>{formatPercent(municipality?.idm?.[Object.keys(municipality?.idm ?? {}).at(-1)])}</strong></div>
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} className="radar-svg" role="img" aria-label={`Radar de ${municipality?.name ?? title}`}>
        {levels.map((level) => <polygon key={level} points={points.map((point) => `${(center + Math.cos(point.angle) * radius * level).toFixed(2)},${(center + Math.sin(point.angle) * radius * level).toFixed(2)}`).join(' ')} className="radar-grid" />)}
        {points.map((point) => <line key={point.key} x1={center} y1={center} x2={center + Math.cos(point.angle) * radius} y2={center + Math.sin(point.angle) * radius} className="radar-axis" />)}
        <polygon points={points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')} className={`radar-shape ${tone}`} />
        {points.map((point) => <g key={`${point.key}-label`}><circle cx={point.x} cy={point.y} r="3.6" className={`radar-node ${tone}`} /><text x={point.labelX} y={point.labelY} textAnchor="middle" className="radar-label">{point.shortLabel}</text></g>)}
      </svg>
    </article>
  );
}

function RegionMiniMap({ features, municipalitiesBySlug, macroName, highlightSlug }) {
  const width = 310;
  const height = 112;
  const regionFeatures = useMemo(() => features.filter((feature) => {
    const slug = slugify(feature.properties?.name || '');
    return getMunicipalityRegion(municipalitiesBySlug[slug])?.macro === macroName;
  }), [features, municipalitiesBySlug, macroName]);
  const project = useMemo(() => createProjector(regionFeatures.length ? regionFeatures : features, width, height, 6, 'top'), [regionFeatures, features]);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="region-map" role="img" aria-label={`Mapa da regiao ${macroName}`}>
      {features.map((feature) => {
        const slug = slugify(feature.properties?.name || '');
        const municipality = municipalitiesBySlug[slug];
        const isInMacro = getMunicipalityRegion(municipality)?.macro === macroName;
        const isHighlight = slug === highlightSlug;
        if (!isInMacro) return null;
        return <path key={slug} d={geometryToPath(feature.geometry, project)} fill={isHighlight ? '#2f6b8f' : '#85b5cf'} stroke="#ffffff" strokeWidth={isHighlight ? 1.3 : 0.8} />;
      })}
    </svg>
  );
}

function ChoroplethMap({ features, municipalitiesBySlug, year, metricKey, metricLabel, selectedSlug, onSelect, classBands, onHoverSlugChange }) {
  const [hovered, setHovered] = useState(null);
  const [tooltip, setTooltip] = useState({ x: 0, y: 0 });
  const width = 980;
  const height = 430;
  const enriched = useMemo(() => {
    const rows = features.map((feature) => {
      const slug = slugify(feature.properties?.name || '');
      const municipality = municipalitiesBySlug[slug];
      return { feature, municipality, slug, value: municipality ? getMetricValue(municipality, year, metricKey) : null };
    }).filter((item) => item.municipality);
    const values = rows.map((item) => item.value).filter((value) => value != null);
    const ranked = [...rows].filter((item) => item.value != null).sort((a, b) => b.value - a.value);
    return {
      rows,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
      rankBySlug: Object.fromEntries(ranked.map((item, index) => [item.slug, index + 1])),
      project: createProjector(rows.map((item) => item.feature), width, height, 12),
    };
  }, [features, municipalitiesBySlug, year, metricKey]);
  return (
    <div className="map-shell">
      <div className="map-frame">
        <svg viewBox={`0 0 ${width} ${height}`} className="map-svg" role="img" aria-label="Mapa dos municipios de Pernambuco">
          {enriched.rows.map((item) => {
            const isSelected = item.slug === selectedSlug;
            const isHovered = hovered?.slug === item.slug;
            return (
              <path
                key={item.slug}
                d={geometryToPath(item.feature.geometry, enriched.project)}
                fill={metricColor(item.value, enriched.min, enriched.max, metricKey)}
                stroke={isSelected || isHovered ? '#294d66' : '#ffffff'}
                strokeWidth={isSelected || isHovered ? 1.8 : 0.85}
                className={`map-path ${isHovered ? 'hovered' : ''}`}
                onMouseEnter={() => {
                  setHovered(item);
                  onHoverSlugChange?.(item.slug);
                }}
                onMouseMove={(event) => setTooltip({ x: event.clientX, y: event.clientY })}
                onMouseLeave={() => {
                  setHovered(null);
                  onHoverSlugChange?.(null);
                }}
                onClick={() => onSelect(item.slug)}
              />
            );
          })}
        </svg>
      </div>
      <div className="home-map-legend" aria-label="Legenda do mapa">
        {classBands.map((band) => (
          <span key={band.key}>
            <i style={{ background: IDM_CLASS_COLORS[band.key] }} />
            {band.label}
          </span>
        ))}
      </div>
      {hovered ? (
        <div className="map-floating-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="map-hover-card">
            <strong>{hovered.municipality.name}</strong>
            <span>{metricLabel} {year}: {formatDecimal(hovered.value)}</span>
            <span>IDM {year}: {formatDecimal(hovered.municipality.idm?.[year])} · {valueClass(classBands, hovered.municipality.idm?.[year])}</span>
            <span>Rank #{enriched.rankBySlug[hovered.slug] ?? 'N/D'} · {getRegionLabel(hovered.municipality)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HomeRankingPanel({ rows, selectedSlug, onSelect, year }) {
  return (
    <article className="panel home-ranking-panel">
      <div className="home-ranking-head">
        <div>
          <span className="eyebrow">Ranking Geral</span>
          <h3>Top 10 municipios</h3>
        </div>
      </div>
      <div className="home-ranking-list">
        {rows.slice(0, 10).map((item, index) => (
          <button
            key={item.municipality.slug}
            type="button"
            className={`home-ranking-row ${item.municipality.slug === selectedSlug ? 'active' : ''}`}
            onClick={() => onSelect(item.municipality.slug)}
          >
            <span className="home-ranking-index">{index + 1}</span>
            <strong>{item.municipality.name}</strong>
            <b>{formatDecimal(item.value)}</b>
          </button>
        ))}
      </div>
    </article>
  );
}

function HomeDimensionRankings({ dimensions, rankings, selectedSlug, onSelect }) {
  return (
    <article className="panel home-dimension-panel">
      {dimensions.map((dimension) => (
        <section key={dimension.key} className="dimension-ranking-card">
          <span className="eyebrow">{dimension.key === 'governanca' ? 'Governanca' : dimension.label}</span>
          <h3>Top 5</h3>
          <div className="dimension-ranking-list">
            {(rankings[dimension.key] ?? []).map((item, index) => (
              <button
                key={item.municipality.slug}
                type="button"
                className={`dimension-ranking-row ${item.municipality.slug === selectedSlug ? 'active' : ''}`}
                onClick={() => onSelect(item.municipality.slug)}
                title={`${item.municipality.name} - ${formatDecimal(item.value)}`}
              >
                <span>{index + 1}</span>
                <strong>{item.municipality.name}</strong>
                <b>{formatDecimal(item.value)}</b>
              </button>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

function MunicipalityCombobox({ municipalities, selectedName, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const normalizedValue = slugify(query);
  const visibleMunicipalities = useMemo(() => {
    if (!normalizedValue) return municipalities;
    return municipalities.filter((municipality) => slugify(municipality.name).includes(normalizedValue));
  }, [municipalities, normalizedValue]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  function openList() {
    setQuery('');
    setIsOpen(true);
  }

  function handleSelect(municipality) {
    onSelect(municipality.slug);
    setQuery('');
    setIsOpen(false);
  }

  return (
    <div className="municipality-combobox" ref={rootRef}>
      <span className="field-label">Municipio em destaque</span>
      <button
        type="button"
        className="municipality-select-button"
        onClick={() => (isOpen ? setIsOpen(false) : openList())}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span>{selectedName}</span>
        <b>⌄</b>
      </button>
      {isOpen ? (
        <div className="municipality-options">
          <input
            ref={searchRef}
            className="municipality-option-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setIsOpen(false);
              if (event.key === 'Enter' && visibleMunicipalities[0]) handleSelect(visibleMunicipalities[0]);
            }}
            placeholder="Buscar municipio"
            aria-label="Buscar municipio"
          />
          <div className="municipality-option-list" role="listbox">
          {visibleMunicipalities.map((municipality) => (
            <button
              key={municipality.slug}
              type="button"
              className={`municipality-option ${municipality.name === selectedName ? 'active' : ''}`}
              onClick={() => handleSelect(municipality)}
              role="option"
              aria-selected={municipality.name === selectedName}
            >
              {municipality.name}
            </button>
          ))}
          {!visibleMunicipalities.length ? <div className="municipality-empty">Nenhum municipio encontrado</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RegionPanel({ dataset, selectedYear, municipalities, metricKey, features, municipalitiesBySlug }) {
  const previousYear = String(Number(selectedYear) - 1);
  const macros = Object.entries(dataset.regionSummary.macro).map(([name, values]) => {
    const macroMunicipalities = municipalities.filter((municipality) => getMunicipalityRegion(municipality)?.macro === name).sort((a, b) => (getMetricValue(b, selectedYear, metricKey) ?? -1) - (getMetricValue(a, selectedYear, metricKey) ?? -1));
    const average = values[selectedYear];
    const previous = values[previousYear] ?? null;
    return { name, average, delta: average != null && previous != null ? average - previous : null, municipalities: macroMunicipalities, regionals: [...new Set(macroMunicipalities.map((municipality) => getMunicipalityRegion(municipality)?.regional).filter(Boolean))], topMunicipality: macroMunicipalities[0] ?? null };
  }).sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
  const regionais = Object.entries(dataset.regionSummary.regional).map(([name, values]) => ({ name, value: values[selectedYear], previous: values[previousYear] ?? null })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).slice(0, 8);
  return (
    <section className="region-page">
      <div className="region-grid">
        {macros.map((macro) => (
          <article key={macro.name} className="panel region-card">
            <div className="region-card-head">
              <div><span className="eyebrow">Macro-regiao</span><h3>{macro.name}</h3></div>
            </div>
            <RegionMiniMap features={features} municipalitiesBySlug={municipalitiesBySlug} macroName={macro.name} highlightSlug={macro.topMunicipality?.slug} />
            <div className="region-stat-row">
              <div className="mini-stat"><span>Variacao anual</span><strong>{formatPercentDelta(macro.delta)}</strong></div>
              <div className="mini-stat"><span>Municipios</span><strong>{macro.municipalities.length}</strong></div>
              <div className="mini-stat"><span>Regionais</span><strong>{macro.regionals.length}</strong></div>
            </div>
            <p className="panel-copy">{MACRO_COPY[macro.name] ?? 'Leitura sintetica da regiao com base na distribuicao municipal.'}</p>
            <div className="region-list">
              {macro.municipalities.slice(0, 4).map((municipality, index) => <div key={municipality.slug} className="region-list-row"><span>#{index + 1}</span><strong>{municipality.name}</strong><b>{formatPercent(getMetricValue(municipality, selectedYear, metricKey))}</b></div>)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MunicipalityPage({ dataset, municipality, selectedYear, focusDimension, setFocusDimension, metricTrend, topMunicipalities }) {
  const dimensionMap = Object.fromEntries(dataset.dimensions.map((dimension) => [dimension.key, dimension]));
  const focusIndicators = dataset.indicatorMetadata.filter((indicator) => indicator.dimension === focusDimension).map((indicator) => ({ ...indicator, value: municipality.indicators?.[selectedYear]?.[indicator.key] ?? null })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return (
    <section className="municipality-page">
      <section className="panel municipality-hero">
        <div className="section-heading municipality-heading">
          <div><span className="eyebrow">Painel municipal</span><h2>{municipality.name}</h2><p className="section-copy">{getMunicipalityNarrative(municipality, selectedYear, dataset.dimensions)}</p></div>
          <div className="hero-metrics">
            <div className="hero-metric"><span>IDM {selectedYear}</span><strong>{formatPercent(municipality.idm?.[selectedYear])}</strong></div>
            <div className="hero-metric"><span>Regiao</span><strong>{municipality.region?.regional ?? 'Sem dado'}</strong></div>
          </div>
        </div>
        <div className="municipality-chip-row">
          {topMunicipalities.map((item) => <button key={item.slug} type="button" className={`municipality-chip ${item.slug === municipality.slug ? 'active' : ''}`} onClick={() => setHashRoute({ page: 'municipio', slug: item.slug })}>{item.name}</button>)}
        </div>
        <div className="dimension-card-grid">
          {dataset.dimensions.map((dimension) => <button key={dimension.key} type="button" className={`dimension-feature ${focusDimension === dimension.key ? 'active' : ''}`} onClick={() => setFocusDimension(dimension.key)}><span>{dimension.label}</span><strong>{formatPercent(municipality.dimensions?.[dimension.key]?.[selectedYear] ?? null)}</strong></button>)}
        </div>
      </section>
      <section className="municipality-detail-grid">
        <article className="panel"><span className="eyebrow">Serie historica</span><h3>Evolucao do IDM-PE</h3><TrendChart values={metricTrend} /></article>
        <article className="panel">
          <div className="section-heading"><div><span className="eyebrow">Dimensao ativa</span><h3>{dimensionMap[focusDimension]?.label}</h3><p className="section-copy">{dimensionMap[focusDimension]?.description}</p></div><div className="section-tag">{formatPercent(municipality.dimensions?.[focusDimension]?.[selectedYear])}</div></div>
          <div className="indicator-spotlight-list">
            {focusIndicators.slice(0, 6).map((indicator) => <article key={indicator.key} className="indicator-spotlight-card"><div className="indicator-spotlight-top"><div><strong>{indicator.label}</strong><span>{indicator.polarity === 'positive' ? 'Tendencia positiva' : 'Tendencia negativa'}</span></div><b>{formatPercent(indicator.value)}</b></div><p>{indicator.description}</p><div className="indicator-bar"><span style={{ width: `${Math.max(0, Math.min(100, (indicator.value ?? 0) * 100))}%` }} /></div></article>)}
          </div>
        </article>
      </section>
    </section>
  );
}

function ComparisonSidebar({ title, municipality, value, onChange, municipalities, position }) {
  return (
    <aside className={`panel compare-sidebar ${position}`}>
      <div className="section-heading stacked compact-sidebar-head">
        <div><span className="eyebrow">{title}</span><h3>{municipality?.name ?? 'Selecione'}</h3></div>
      </div>
      <label className="compare-select-field">
        <span className="field-label">Municipio</span>
        <div className="select-shell">
          <select value={value} onChange={(event) => onChange(event.target.value)}>{municipalities.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
        </div>
      </label>
      <div className="compare-sidebar-list">
        <div className="compare-list-row"><span>IDM 2023</span><strong>{formatPercent(municipality?.idm?.[2023])}</strong></div>
        <div className="compare-list-row"><span>Macro</span><strong>{municipality?.region?.macro ?? 'Sem dado'}</strong></div>
        <div className="compare-list-row"><span>Regional</span><strong>{municipality?.region?.regional ?? 'Sem dado'}</strong></div>
      </div>
    </aside>
  );
}

function ComparisonPanel({ dataset, selectedYear, municipalities, leftMunicipality, rightMunicipality, leftComparison, rightComparison, setLeftComparison, setRightComparison, comparisonScope, setComparisonScope }) {
  const scopeOptions = [{ key: '__overview', label: 'Visao geral' }, ...dataset.dimensions.map((dimension) => ({ key: dimension.key, label: dimension.label }))];
  const comparisonItems = useMemo(() => {
    if (comparisonScope === '__overview') {
      return dataset.dimensions.map((dimension) => ({ key: dimension.key, shortLabel: compactRadarLabel(dimension.label, true), label: dimension.label, valueLeft: leftMunicipality?.dimensions?.[dimension.key]?.[selectedYear] ?? null, valueRight: rightMunicipality?.dimensions?.[dimension.key]?.[selectedYear] ?? null }));
    }
    return dataset.indicatorMetadata.filter((indicator) => indicator.dimension === comparisonScope).map((indicator) => ({ key: indicator.key, shortLabel: compactRadarLabel(indicator.label), label: indicator.label, valueLeft: leftMunicipality?.indicators?.[selectedYear]?.[indicator.key] ?? null, valueRight: rightMunicipality?.indicators?.[selectedYear]?.[indicator.key] ?? null })).sort((a, b) => Math.abs((b.valueLeft ?? 0) - (b.valueRight ?? 0)) - Math.abs((a.valueLeft ?? 0) - (a.valueRight ?? 0))).slice(0, 8);
  }, [comparisonScope, dataset, leftMunicipality, rightMunicipality, selectedYear]);
  return (
    <section className="comparison-layout">
      <ComparisonSidebar title="Municipio A" municipality={leftMunicipality} value={leftComparison} onChange={setLeftComparison} municipalities={municipalities} position="left" />
      <section className="panel compare-stage">
        <div className="compare-scope">
          {scopeOptions.map((option) => <button key={option.key} type="button" className={`scope-chip ${comparisonScope === option.key ? 'active' : ''}`} onClick={() => setComparisonScope(option.key)}>{option.label}</button>)}
        </div>
        <div className="compare-radar-grid">
          <RadarChart title={leftMunicipality?.name ?? 'Municipio A'} municipality={leftMunicipality} items={comparisonItems.map((item) => ({ ...item, value: item.valueLeft }))} tone="blue" />
          <RadarChart title={rightMunicipality?.name ?? 'Municipio B'} municipality={rightMunicipality} items={comparisonItems.map((item) => ({ ...item, value: item.valueRight }))} tone="sand" />
        </div>
        <div className="compare-metric-list">
          {comparisonItems.map((item) => {
            const leftValue = item.valueLeft ?? 0;
            const rightValue = item.valueRight ?? 0;
            const total = Math.max(leftValue + rightValue, 0.0001);
            return (
              <div key={item.key} className="compare-metric-row">
                <div className="compare-value left"><strong>{formatPercent(item.valueLeft)}</strong><div className="bar-track"><span style={{ width: `${(leftValue / total) * 100}%` }} /></div></div>
                <div className="compare-label">{item.label}</div>
                <div className="compare-value right"><div className="bar-track"><span style={{ width: `${(rightValue / total) * 100}%` }} /></div><strong>{formatPercent(item.valueRight)}</strong></div>
              </div>
            );
          })}
        </div>
      </section>
      <ComparisonSidebar title="Municipio B" municipality={rightMunicipality} value={rightComparison} onChange={setRightComparison} municipalities={municipalities} position="right" />
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
  const [overviewTab, setOverviewTab] = useState('atlas');
  const [comparisonScope, setComparisonScope] = useState('__overview');
  const [hoveredSlug, setHoveredSlug] = useState(null);

  useEffect(() => {
    const syncRoute = () => setRoute(getRouteFromHash());
    window.addEventListener('hashchange', syncRoute);
    syncRoute();
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  const model = useMemo(() => {
    const metricOptions = [{ key: 'idm', label: 'IDM-PE', dimension: null }, ...dataset.dimensions.map((dimension) => ({ key: `dimension:${dimension.key}`, label: dimension.label, dimension: dimension.key })), ...dataset.indicatorMetadata.map((indicator) => ({ key: `indicator:${indicator.key}`, label: indicator.label, dimension: indicator.dimension }))];
    return { municipalities: dataset.municipalities, municipalitiesBySlug: Object.fromEntries(dataset.municipalities.map((municipality) => [municipality.slug, municipality])), yearStrings: dataset.years.map(String), metricMap: Object.fromEntries(metricOptions.map((metric) => [metric.key, metric])) };
  }, []);

  useEffect(() => {
    if (route.page === 'municipio' && route.slug && model.municipalitiesBySlug[route.slug]) setSelectedSlug(route.slug);
  }, [route, model]);

  const selectedMunicipality = model.municipalitiesBySlug[selectedSlug] ?? model.municipalities[0];
  const leftMunicipality = model.municipalitiesBySlug[leftComparison] ?? null;
  const rightMunicipality = model.municipalitiesBySlug[rightComparison] ?? null;
  const selectedMetric = model.metricMap[metricKey] ?? { label: 'IDM-PE' };
  const yearlyRows = useMemo(() => model.municipalities.map((municipality) => ({ municipality, value: getMetricValue(municipality, selectedYear, metricKey) })).filter((item) => item.value != null).sort((a, b) => b.value - a.value), [model, selectedYear, metricKey]);
  const selectedRank = useMemo(() => yearlyRows.findIndex((item) => item.municipality.slug === selectedMunicipality.slug) + 1, [selectedMunicipality, yearlyRows]);
  const overview = useMemo(() => {
    const summaryForYear = dataset.summary.years[selectedYear];
    const average = yearlyRows.reduce((accumulator, item) => accumulator + item.value, 0) / Math.max(yearlyRows.length, 1);
    const previousYear = String(Number(selectedYear) - 1);
    const deltas = model.municipalities.map((municipality) => {
      const current = getMetricValue(municipality, selectedYear, metricKey);
      const previous = getMetricValue(municipality, previousYear, metricKey);
      return current == null || previous == null ? null : { municipality, delta: current - previous };
    }).filter(Boolean).sort((a, b) => b.delta - a.delta);
    return { average, top: yearlyRows[0] ?? null, classCounts: summaryForYear.classCounts, biggestClimb: deltas[0] ?? null };
  }, [selectedYear, metricKey, yearlyRows, model]);
  const idmRows = useMemo(() => model.municipalities.map((municipality) => ({ municipality, value: municipality.idm?.[selectedYear] ?? null })).filter((item) => item.value != null).sort((a, b) => b.value - a.value), [model, selectedYear]);
  const dimensionRankings = useMemo(() => Object.fromEntries(dataset.dimensions.map((dimension) => [
    dimension.key,
    model.municipalities
      .map((municipality) => ({ municipality, value: municipality.dimensions?.[dimension.key]?.[selectedYear] ?? null }))
      .filter((item) => item.value != null)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  ])), [model, selectedYear]);
  const topMunicipalities = yearlyRows.slice(0, 8).map((item) => item.municipality);
  const activeHomeMunicipality = model.municipalitiesBySlug[hoveredSlug] ?? selectedMunicipality;
  const activeHomeRank = yearlyRows.findIndex((item) => item.municipality.slug === activeHomeMunicipality.slug) + 1;
  const previousSelectedYear = String(Number(selectedYear) - 1);
  const activeHomeIdmDelta = activeHomeMunicipality.idm?.[selectedYear] != null && activeHomeMunicipality.idm?.[previousSelectedYear] != null
    ? activeHomeMunicipality.idm[selectedYear] - activeHomeMunicipality.idm[previousSelectedYear]
    : null;
  const deltaRankRows = useMemo(() => model.municipalities
    .map((municipality) => {
      const current = municipality.idm?.[selectedYear];
      const previous = municipality.idm?.[previousSelectedYear];
      return current == null || previous == null ? null : { municipality, value: current - previous };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value), [model, selectedYear, previousSelectedYear]);
  const activeHomeDeltaRank = deltaRankRows.findIndex((item) => item.municipality.slug === activeHomeMunicipality.slug) + 1;

  function handleMetricChange(nextMetricKey) {
    startTransition(() => {
      setMetricKey(nextMetricKey);
      const metric = model.metricMap[nextMetricKey];
      if (metric?.dimension) setFocusDimension(metric.dimension);
    });
  }

  function handleOverviewRoute(tab = 'atlas') {
    setOverviewTab(tab);
    setHashRoute({ page: 'overview' });
  }

  function handleNav(key) {
    if (key === 'overview') handleOverviewRoute('atlas');
    if (key === 'comparacao') handleOverviewRoute('comparacao');
    if (key === 'regioes') setHashRoute({ page: 'regioes' });
    if (key === 'municipio') setHashRoute({ page: 'municipio', slug: selectedMunicipality.slug });
  }

  const activeNav = route.page === 'regioes' ? 'regioes' : route.page === 'municipio' ? 'municipio' : overviewTab === 'comparacao' ? 'comparacao' : 'overview';

  const isAtlasHome = route.page === 'overview' && overviewTab === 'atlas';

  return (
    <div className={`app-shell ${isAtlasHome ? 'home-atlas-shell' : ''}`}>
      <nav className="topbar panel">
        <button type="button" className="brand-lockup" onClick={() => handleOverviewRoute('atlas')}>
          <span className="brand-mark">IDM</span>
          <span className="brand-copy"><strong>IDM-PE</strong><small>painel territorial</small></span>
        </button>
        {isAtlasHome ? (
          <div className="latest-index-badge">
            <span>Últimos índices calculados</span>
            <strong>{latestYear}</strong>
          </div>
        ) : <div className="topbar-spacer" aria-hidden="true" />}
        <div className="topbar-links">
          <button type="button" className={`nav-link ${activeNav === 'overview' ? 'active' : ''}`} onClick={() => handleNav('overview')}>Home</button>
          <button type="button" className={`nav-link ${activeNav === 'regioes' ? 'active' : ''}`} onClick={() => handleNav('regioes')}>Regioes</button>
          <button type="button" className={`nav-link ${activeNav === 'comparacao' ? 'active' : ''}`} onClick={() => handleNav('comparacao')}>Comparacao</button>
          <button type="button" className={`nav-link ${activeNav === 'municipio' ? 'active' : ''}`} onClick={() => handleNav('municipio')}>Municipio</button>
        </div>
      </nav>

      {route.page === 'overview' && overviewTab === 'atlas' ? (
        <section className="panel control-bar map-info-bar">
          <div className="map-info-item map-info-item-primary">
            <MunicipalityCombobox
              municipalities={model.municipalities}
              selectedName={selectedMunicipality.name}
              onSelect={setSelectedSlug}
            />
          </div>
          <div className="map-info-item">
            <span className="field-label">{selectedMetric.label} {selectedYear}</span>
            <strong>{formatDecimal(getMetricValue(activeHomeMunicipality, selectedYear, metricKey))}</strong>
          </div>
          <div className="map-info-item">
            <span className="field-label">Variacao IDM vs. {previousSelectedYear}</span>
            <strong className={`delta-value ${activeHomeIdmDelta > 0 ? 'positive' : activeHomeIdmDelta < 0 ? 'negative' : 'neutral'}`}>
              {activeHomeIdmDelta > 0 ? <i aria-hidden="true" className="delta-triangle up" /> : null}
              {activeHomeIdmDelta < 0 ? <i aria-hidden="true" className="delta-triangle down" /> : null}
              {formatIndexDelta(activeHomeIdmDelta)}
            </strong>
          </div>
          <div className="map-info-item">
            <span className="field-label">Ranking da variacao</span>
            <strong>{activeHomeDeltaRank > 0 ? `Rank #${activeHomeDeltaRank}` : 'Sem base'}</strong>
          </div>
          <div className="map-info-item">
            <span className="field-label">Classificacao</span>
            <strong>
              Rank #{activeHomeRank > 0 ? activeHomeRank : 'N/D'} · {valueClass(dataset.classBands, activeHomeMunicipality.idm?.[selectedYear])}
            </strong>
            <div className="classification-tooltip" role="tooltip">
              {dataset.classBands.map((band) => (
                <span key={band.key}><b>{band.label}</b> {shortClassDescription(band)}</span>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      {route.page !== 'regioes' && !(route.page === 'overview' && overviewTab === 'comparacao') && !(route.page === 'overview' && overviewTab === 'atlas') ? (
        <section className="panel control-bar">
          <label><span className="field-label">Ano</span><select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>{model.yearStrings.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label><span className="field-label">Recorte</span><select value={metricKey} onChange={(event) => handleMetricChange(event.target.value)}><optgroup label="Sintese"><option value="idm">IDM-PE</option></optgroup><optgroup label="Dimensoes">{dataset.dimensions.map((dimension) => <option key={dimension.key} value={`dimension:${dimension.key}`}>{dimension.label}</option>)}</optgroup><optgroup label="Indicadores">{dataset.indicatorMetadata.map((indicator) => <option key={indicator.key} value={`indicator:${indicator.key}`}>{indicator.label}</option>)}</optgroup></select></label>
          <label><span className="field-label">Municipio em foco</span><select value={selectedMunicipality.slug} onChange={(event) => setSelectedSlug(event.target.value)}>{model.municipalities.map((municipality) => <option key={municipality.slug} value={municipality.slug}>{municipality.name}</option>)}</select></label>
        </section>
      ) : null}
      {route.page === 'overview' && overviewTab === 'atlas' ? (
        <section className="page-stack">
          <section className="dashboard-grid home-map-layout">
            <HomeRankingPanel rows={idmRows} selectedSlug={selectedMunicipality.slug} onSelect={setSelectedSlug} year={selectedYear} />
            <article className="panel map-page-panel">
              <ChoroplethMap features={geojson.features} municipalitiesBySlug={model.municipalitiesBySlug} year={selectedYear} metricKey={metricKey} metricLabel={selectedMetric.label} selectedSlug={selectedMunicipality.slug} onSelect={setSelectedSlug} classBands={dataset.classBands} onHoverSlugChange={setHoveredSlug} />
            </article>
            <HomeDimensionRankings dimensions={dataset.dimensions} rankings={dimensionRankings} selectedSlug={selectedMunicipality.slug} onSelect={setSelectedSlug} />
          </section>
        </section>
      ) : null}
      {route.page === 'overview' && overviewTab === 'comparacao' ? <ComparisonPanel dataset={dataset} selectedYear={selectedYear} municipalities={model.municipalities} leftMunicipality={leftMunicipality} rightMunicipality={rightMunicipality} leftComparison={leftComparison} rightComparison={rightComparison} setLeftComparison={setLeftComparison} setRightComparison={setRightComparison} comparisonScope={comparisonScope} setComparisonScope={setComparisonScope} /> : null}
      {route.page === 'municipio' ? <MunicipalityPage dataset={dataset} municipality={selectedMunicipality} selectedYear={selectedYear} focusDimension={focusDimension} setFocusDimension={setFocusDimension} metricTrend={model.yearStrings.map((year) => ({ label: year, value: selectedMunicipality.idm?.[year] ?? null }))} topMunicipalities={topMunicipalities} /> : null}
      {route.page === 'regioes' ? <RegionPanel dataset={dataset} selectedYear={selectedYear} municipalities={model.municipalities} metricKey={metricKey} features={geojson.features} municipalitiesBySlug={model.municipalitiesBySlug} /> : null}
    </div>
  );
}

export default App;
