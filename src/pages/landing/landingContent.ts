export type LandingCategory = {
  name: string;
  description: string;
};

export type LandingService = {
  title: string;
  description: string;
};

export type LandingFaqItem = {
  question: string;
  answer: string;
};

export type LandingStep = {
  title: string;
  description: string;
};

export type LandingContact = {
  phone: string;
  /** Additional numbers, e.g. a second branch or a sales line. */
  alternatePhones?: string[];
  whatsapp: string;
  email: string;
  /** Secondary mailbox, e.g. accounts or support. */
  alternateEmail?: string;
  instagram: string;
  address: string;
  workingHours: string;
};

export type LandingShowroomProfile = {
  brandName: string;
  shortTagline: string;
  heroTitle: string;
  heroDescription: string;
  aboutTitle: string;
  aboutDescription: string;
  categories: LandingCategory[];
  services: LandingService[];
  steps: LandingStep[];
  faq: LandingFaqItem[];
  contact: LandingContact;
};

export const landingShowroomProfile: LandingShowroomProfile = {
  brandName: 'LENA للمعرض',
  shortTagline: 'معرض فساتين وحقائب وإكسسوارات للمناسبات',
  heroTitle: 'اختاري إطلالتك من المعرض قبل الزيارة',
  heroDescription:
    'صفحة عرض مخصصة للعميلة تساعدها على تصفح الفساتين والملحقات المتاحة، مقارنة خيارات الإيجار والبيع، ثم الانتقال مباشرة إلى حجز موعد التجربة داخل المعرض.',
  aboutTitle: 'من نحن',
  aboutDescription:
    'نحن معرض متخصص في فساتين المناسبات وملحقاتها، نهتم بأن تجد العميلة الإطلالة المناسبة بسهولة ووضوح قبل الموعد. نعرض المتاح حاليًا، ونوضح الفئات والخدمات، ثم نوجّه العميلة إلى زيارة منظمة داخل المعرض للحجز أو الشراء أو المعاينة.',
  categories: [
    { name: 'زفاف', description: 'فساتين الزفاف الأساسية والمميزة للمواعيد الخاصة.' },
    { name: 'خطوبة', description: 'موديلات مناسبة لحفلات الخطوبة والملكة.' },
    { name: 'سهرة', description: 'فساتين سهرات ومناسبات مسائية متنوعة.' },
    { name: 'أطفال', description: 'خيارات مناسبة للأعمار الصغيرة والمناسبات العائلية.' },
    { name: 'إكسسوارات', description: 'قطع مكملة للإطلالة مثل المجوهرات والتيجان.' },
    { name: 'حقائب', description: 'حقائب تناسب الإطلالات الرسمية والمناسبات.' },
    { name: 'أحذية', description: 'خيارات منسقة مع بعض الإطلالات عند توفرها.' },
    { name: 'طرح وشالات', description: 'عناصر مكملة مثل الطرح والشالات والأغطية المناسبة.' },
  ],
  services: [
    {
      title: 'إيجار فساتين',
      description: 'عرض القطع المتاحة للإيجار مع السعر والتأمين عند الحاجة.',
    },
    {
      title: 'بيع فساتين',
      description: 'خيارات جاهزة للبيع المباشر للعميلات بحسب المتاح في المعرض.',
    },
    {
      title: 'إكسسوارات وملحقات',
      description: 'إكمال الإطلالة بقطع إضافية مثل الحقائب والتيجان وبعض الملحقات.',
    },
    {
      title: 'حجز موعد للتجربة',
      description: 'تنظيم الزيارات داخل المعرض لتجربة القطع ومراجعة الخيارات بهدوء.',
    },
  ],
  steps: [
    {
      title: 'تصفحي المعروض',
      description: 'شاهدي القطع المتاحة الآن وفلترّي النتائج حسب الفئة أو نوع الخدمة.',
    },
    {
      title: 'اختاري ما يناسبك',
      description: 'قارني بين المقاسات والألوان والأسعار وحددي الخيارات المناسبة لك.',
    },
    {
      title: 'احجزي موعدك',
      description: 'انتقلي إلى صفحة المواعيد وحددي وقت الزيارة للمعاينة أو التجربة.',
    },
    {
      title: 'جربي وأكدي',
      description: 'زوري المعرض، جربي القطعة، ثم أكدي الإيجار أو الشراء حسب المتاح.',
    },
  ],
  faq: [
    {
      question: 'هل المعروض في الصفحة هو المتاح حاليًا فقط؟',
      answer: 'نعم، الصفحة مصممة لعرض القطع المتاحة حاليًا قدر الإمكان، لكن قد تتغير الحالة بعد الحجز أو البيع أو التحديث الداخلي.',
    },
    {
      question: 'هل يمكن الحجز بدون زيارة المعرض؟',
      answer: 'الصفحة تساعد في الاختيار المبدئي، لكن التأكيد النهائي عادة يتم بعد الموعد والمعاينة داخل المعرض.',
    },
    {
      question: 'هل كل القطع متاحة للإيجار والبيع معًا؟',
      answer: 'ليس دائمًا. بعض القطع للإيجار فقط، وبعضها للبيع فقط، وبعضها قد يكون متاحًا للطريقتين حسب سياسة المعرض.',
    },
    {
      question: 'هل توجد إكسسوارات أو حقائب أو ملحقات؟',
      answer: 'يمكن تخصيص الصفحة لتعرض الفئات الإضافية مثل الإكسسوارات والحقائب والأحذية والطرح بحسب ما يوفره المعرض.',
    },
  ],
  contact: {
    phone: '+968 9191 8186',
    alternatePhones: ['+966 50 868 8213', '+20 121 210 1073'],
    whatsapp: '+968 9191 8186',
    email: 'Ahmedmasoud@outlook.com',
    alternateEmail: 'MohamedMs.oud@outlook.com',
    instagram: '@lena.showroom',
    address: 'سلطنة عمان',
    workingHours: 'السبت إلى الخميس — 10 صباحًا إلى 9 مساءً',
  },
};
