import { useEffect, useMemo, useState } from 'react';
import { getDresses } from '../../features/dresses/dress.service';
import type { Dress } from '../../features/dresses/dress.types';
import { DRESS_CATEGORIES } from '../../shared/domain/dressConstants';
import { getShowroomProfile } from '../../features/preferences/showroomProfile.service';
import type { LandingShowroomProfile } from './landingContent';
import { LandingAboutServices } from './components/LandingAboutServices';
import { LandingCategories } from './components/LandingCategories';
import { LandingContact } from './components/LandingContact';
import { LandingFaq } from './components/LandingFaq';
import { LandingFooter } from './components/LandingFooter';
import { LandingHeader } from './components/LandingHeader';
import { LandingHero } from './components/LandingHero';
import { LandingInventory } from './components/LandingInventory';
import { LandingSteps } from './components/LandingSteps';
import { LandingValueProps } from './components/LandingValueProps';
import type { InventoryCategoryFilter, LandingUsageFilter } from './components/types';

const inventoryCategories = ['all', ...DRESS_CATEGORIES] as const;

export function LandingPage() {
  const [dresses, setDresses] = useState<Dress[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<InventoryCategoryFilter>('all');
  const [usageFilter, setUsageFilter] = useState<LandingUsageFilter>('all');
  const profile: LandingShowroomProfile = getShowroomProfile();

  useEffect(() => {
    const availableDresses = getDresses().filter((dress) => dress.status === 'available');
    setDresses(availableDresses);
    setLoading(false);
  }, []);

  const filteredDresses = useMemo(() => {
    return dresses.filter((dress) => {
      const matchesCategory = selectedCategory === 'all' || dress.category === selectedCategory;
      const matchesUsage = usageFilter === 'all'
        || (usageFilter === 'rent' && dress.isForRent)
        || (usageFilter === 'sale' && dress.isForSale);
      const normalizedSearch = search.trim().toLowerCase();
      const matchesSearch = normalizedSearch.length === 0
        || [dress.name, dress.category, dress.color, dress.size]
          .some((value) => value.toLowerCase().includes(normalizedSearch));

      return matchesCategory && matchesUsage && matchesSearch;
    });
  }, [dresses, search, selectedCategory, usageFilter]);

  const rentableCount = dresses.filter((dress) => dress.isForRent).length;
  const saleCount = dresses.filter((dress) => dress.isForSale).length;

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900" dir="rtl">
      <LandingHeader profile={profile} />

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <LandingHero
          profile={profile}
          total={dresses.length}
          rentableCount={rentableCount}
          saleCount={saleCount}
        />
        <LandingValueProps />
        <LandingCategories profile={profile} />
        <LandingInventory
          profile={profile}
          dresses={filteredDresses}
          loading={loading}
          search={search}
          onSearchChange={setSearch}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          usageFilter={usageFilter}
          onUsageChange={setUsageFilter}
          inventoryCategories={inventoryCategories}
        />
        <LandingAboutServices profile={profile} />
        <LandingSteps profile={profile} />
        <LandingFaq profile={profile} />
        <LandingContact profile={profile} />
      </main>

      <LandingFooter profile={profile} />
    </div>
  );
}
