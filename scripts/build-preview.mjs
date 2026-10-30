import { build } from 'vite';

process.env.VITE_PUBLIC_PREVIEW = 'true';
await build();
