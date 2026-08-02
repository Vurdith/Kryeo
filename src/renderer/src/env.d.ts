/// <reference types="vite/client" />

import type { KryeoApi } from '../../shared/types';

declare global {
  interface Window {
    kryeo: KryeoApi;
  }
}

export {};
