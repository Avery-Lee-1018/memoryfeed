import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function CardSkeleton() {
  return (
    <Card className="w-full overflow-hidden rounded-2xl border-0 shadow-sm animate-pulse">
      {/* Thumbnail */}
      <div className="h-[201px] w-full bg-gray-200" />

      {/* Header */}
      <CardHeader className="pb-2 pt-4">
        <div className="h-3 w-20 rounded bg-gray-200" />
        <div className="mt-2 space-y-1.5">
          <div className="h-4 w-full rounded bg-gray-200" />
          <div className="h-4 w-3/4 rounded bg-gray-200" />
        </div>
      </CardHeader>

      {/* Summary */}
      <CardContent className="pb-0 pt-0 space-y-1.5">
        <div className="h-3 w-full rounded bg-gray-200" />
        <div className="h-3 w-full rounded bg-gray-200" />
        <div className="h-3 w-4/5 rounded bg-gray-200" />
        <div className="h-3 w-2/3 rounded bg-gray-200" />
      </CardContent>

      {/* Actions */}
      <CardContent className="flex items-center justify-between pb-4 pt-5">
        <div className="h-3 w-16 rounded bg-gray-200" />
        <div className="h-3 w-10 rounded bg-gray-200" />
      </CardContent>
    </Card>
  );
}
