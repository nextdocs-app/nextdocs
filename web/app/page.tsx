'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const Sidebar = dynamic(() => import('@/components/Sidebar'), { ssr: false });
const Workspace = dynamic(() => import('@/components/Workspace'), {
  ssr: false,
});

export default function Home() {
  return (
    <Suspense>
      <div className="flex h-screen">
        <Sidebar />
        <Workspace />
      </div>
    </Suspense>
  );
}
