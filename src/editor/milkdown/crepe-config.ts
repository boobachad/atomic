import { Crepe } from '@milkdown/crepe';
import type { CrepeConfig } from '@milkdown/crepe';

export const ATOMIC_CREPE_BASE_CONFIG: CrepeConfig = {
  features: {
    [Crepe.Feature.Toolbar]: false,
    [Crepe.Feature.LinkTooltip]: false,
    [Crepe.Feature.Cursor]: false,
  },
  featureConfigs: {
    [Crepe.Feature.Placeholder]: {
      text: '',
    },
  },
};

export function withAtomicImageConfig(crepeConfig?: CrepeConfig): CrepeConfig | undefined {
  const features = crepeConfig?.features;
  const featureConfigs = crepeConfig?.featureConfigs;

  return {
    ...crepeConfig,
    features: {
      ...features,
      [Crepe.Feature.Cursor]: false,
    },
    featureConfigs: {
      ...featureConfigs,
      [Crepe.Feature.ImageBlock]: {
        ...featureConfigs?.[Crepe.Feature.ImageBlock],
        inlineUploadButton: '',
        inlineUploadPlaceholderText: 'paste link',
        blockUploadButton: '',
        blockUploadPlaceholderText: 'paste link',
      },
    },
  };
}
