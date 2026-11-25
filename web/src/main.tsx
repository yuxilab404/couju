import { createRoot } from 'react-dom/client';
import { PlatformApp } from '@couju/platform';
import { games } from './games.ts';

declare const __BUILD_ID__: string;

createRoot(document.getElementById('root')!).render(<PlatformApp games={games} buildId={__BUILD_ID__} />);
