// File: dashboard/src/pages/PriceBand.tsx
import React, { useEffect, useState } from 'react';

interface PriceBandData {
  currentPrice: number;
  lowerBound: number;
  upperBound: number;
}

export default function PriceBand() {
  const [data, setData] = useState<PriceBandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/price-band');
        if (!res.ok) throw new Error('Network response was not ok');
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <div>Loading price band...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!data) return <div>No data available.</div>;

  const status = data.currentPrice < data.lowerBound
    ? 'Below Lower Bound'
    : data.currentPrice > data.upperBound
      ? 'Above Upper Bound'
      : 'Within Band';

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Guaso Coin Price Band</h1>
      <p>Current Price: {data.currentPrice.toFixed(6)} USDC</p>
      <p>Lower Bound: {data.lowerBound.toFixed(6)} USDC</p>
      <p>Upper Bound: {data.upperBound.toFixed(6)} USDC</p>
      <p className="mt-4 font-medium">Status: {status}</p>
    </div>
  );
}
