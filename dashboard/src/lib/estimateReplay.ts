import { LookupEstimateResult } from './estimateData';
import { SharePathId, selectSharePath } from './sharePaths';

export interface ReplayPrompt {
  promptLine: string;
  suggestTypes: string[];
}

const WARD_FASTER_RATIO = 1.5;

const SKIP_EXPLORATION_PATHS: SharePathId[] = ['quick_fix'];

function buildCitywidePrompt(
  pathId: SharePathId,
  suggestions: string[],
): ReplayPrompt {
  if (pathId === 'promise_broken') {
    return {
      promptLine: 'Often misses its deadline citywide. Add your ward for local times — or compare other slow types:',
      suggestTypes: suggestions,
    };
  }
  if (pathId === 'wide_range') {
    return {
      promptLine: 'Resolution times vary widely. Add your ward — or compare other types citywide:',
      suggestTypes: suggestions,
    };
  }
  if (pathId === 'quick_fix') {
    if (suggestions.length === 0) {
      return {
        promptLine: 'Add your ward — neighborhood times can run well above citywide.',
        suggestTypes: [],
      };
    }
    return {
      promptLine: 'Usually resolves quickly citywide. Add your ward — or compare slower types:',
      suggestTypes: suggestions,
    };
  }
  return {
    promptLine: 'Add your ward for local times — or try another common request:',
    suggestTypes: suggestions,
  };
}

export function buildReplayPrompt(options: {
  serviceType: string;
  ward: string | null;
  lookup: LookupEstimateResult | null;
  wardStandouts: string[];
  citywideExploreTypes: string[];
  category: string | null;
}): ReplayPrompt | null {
  const {
    serviceType,
    ward,
    lookup,
    wardStandouts,
    citywideExploreTypes,
    category,
  } = options;

  if (!lookup) {
    if (!ward) {
      const suggestions = citywideExploreTypes
        .filter((type) => type !== serviceType)
        .slice(0, 2);
      return {
        promptLine: 'No closed requests yet for this type. Add your ward, or try a type we can estimate:',
        suggestTypes: suggestions,
      };
    }

    const suggestions = wardStandouts
      .filter((type) => type !== serviceType)
      .slice(0, 2);
    if (suggestions.length === 0) {
      return {
        promptLine: `No closed requests yet for this type — search above for another service type in ${ward}.`,
        suggestTypes: [],
      };
    }
    return {
      promptLine: `No closed requests yet for this type — see what else we can estimate in ${ward}:`,
      suggestTypes: suggestions,
    };
  }

  const shareEstimate = lookup.wardEstimate && !lookup.usedWardFallback
    ? lookup.wardEstimate
    : lookup.estimate;

  const path = selectSharePath({
    serviceType,
    ward,
    estimate: shareEstimate,
    citywideEstimate: lookup.citywideEstimate,
  });

  if (!ward) {
    if (SKIP_EXPLORATION_PATHS.includes(path.id) && citywideExploreTypes.length === 0) {
      return buildCitywidePrompt(path.id, []);
    }
    const suggestions = citywideExploreTypes.slice(0, 2);
    return buildCitywidePrompt(path.id, suggestions);
  }

  if (SKIP_EXPLORATION_PATHS.includes(path.id)) return null;

  const suggestions = wardStandouts
    .filter((type) => type !== serviceType)
    .slice(0, 2);

  if (suggestions.length === 0) {
    return {
      promptLine: `Search above for another service type to compare in ${ward}.`,
      suggestTypes: [],
    };
  }

  const citywide = lookup.citywideEstimate ?? lookup.estimate;
  const wardMedian = lookup.wardEstimate?.p50;
  const isFasterInWard = wardMedian != null
    && !lookup.usedWardFallback
    && wardMedian < citywide.p50 / WARD_FASTER_RATIO;

  let promptLine: string;
  if (isFasterInWard) {
    promptLine = `${serviceType} resolves faster than most types in ${ward}. See what's slowest:`;
  } else if (path.id === 'ward_gap') {
    promptLine = `${serviceType} is slower than citywide in ${ward}. See what else lags in your ward:`;
  } else if (path.id === 'promise_broken') {
    promptLine = category
      ? `This type often misses its deadline. Compare other ${category.toLowerCase()} requests in ${ward}:`
      : `This type often misses its deadline. Compare with other request types in ${ward}:`;
  } else if (path.id === 'wide_range') {
    promptLine = `Resolution times vary widely for ${serviceType}. See how other types compare in ${ward}:`;
  } else {
    promptLine = `See what else resolves slower than citywide in ${ward}:`;
  }

  return { promptLine, suggestTypes: suggestions };
}
