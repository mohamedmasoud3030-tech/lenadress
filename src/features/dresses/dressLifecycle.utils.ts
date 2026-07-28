import type { DressPerformanceRow } from '../reports/report.types';

export type DressLifecycleRecommendationTone = 'positive' | 'warning' | 'neutral';

export type DressLifecycleRecommendation = {
  tone: DressLifecycleRecommendationTone;
  message: string;
};

/**
 * Produces operator-facing guidance from the canonical realised-money report.
 * It never recalculates revenue or expenses inside the inventory page.
 */
export function getDressLifecycleRecommendations(
  performance: DressPerformanceRow,
): DressLifecycleRecommendation[] {
  const recommendations: DressLifecycleRecommendation[] = [];

  if (performance.inactivityDays !== null && performance.inactivityDays >= 90) {
    recommendations.push({
      tone: 'warning',
      message: `لا توجد حركة مسجلة منذ ${performance.inactivityDays} يوماً؛ راجعي السعر أو العرض أو التصوير.`,
    });
  }

  if ((performance.maintenanceCostRatio ?? 0) >= 35) {
    recommendations.push({
      tone: 'warning',
      message: 'تكلفة الخدمة مرتفعة مقارنة بالإيراد المحقق؛ راجعي قرار الصيانة أو البيع.',
    });
  }

  if (performance.netResult < 0) {
    recommendations.push({
      tone: 'warning',
      message: 'النتيجة الحالية سالبة بعد تكلفة الشراء والمصروفات؛ يلزم مراجعة التسعير والتكاليف.',
    });
  }

  if (performance.recoveredPurchaseCost) {
    recommendations.push({
      tone: 'positive',
      message: 'تم استرداد تكلفة الشراء من الإيراد المحقق حتى الآن.',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      tone: 'neutral',
      message: 'لا توجد إشارة تشغيلية حرجة لهذا العنصر حالياً.',
    });
  }

  return recommendations;
}
