"use client";

export default function Chart({ points }: { points: number[] }) {
  return (
    <svg>
      {points.map((p, i) => (
        <circle key={i} cx={i * 10} cy={p} r={2} />
      ))}
    </svg>
  );
}
