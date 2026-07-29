import { readCollection, writeCollection } from '../../services/localDatabase';
import { formatMoneyOMR } from '../../shared/utils/format';
import type { ReminderKind } from './reminder.types';

/**
 * Editable reminder message templates.
 *
 * The four reminder messages were hard-coded in `buildMessage`. Every showroom
 * has its own voice — some address the customer formally, some sign off with a
 * branch name, some want the price left out entirely — and none of that is
 * reachable without a developer. Worse, the owner could see the message about
 * to be sent under her name and had no way to change a single word of it.
 *
 * Templates use `{{placeholder}}` substitution rather than any expression
 * syntax. A template is content the owner edits, not code: an expression
 * language would turn a settings field into an injection surface and would let
 * a typo produce an exception at the moment the operator is trying to send a
 * message to a waiting customer. An unknown placeholder is left visible rather
 * than blanked, so a mistake is obvious in the preview instead of silently
 * producing a sentence with a hole in it.
 */

const COLLECTION = 'message-templates';

export type MessageTemplateVariables = {
  customerName: string;
  dressName: string;
  reservationNumber: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  remainingAmount: string;
  accessories: string;
  brandName: string;
};

export type MessageTemplates = Record<ReminderKind, string>;

/** Placeholders offered in the editor, so the owner does not have to guess. */
export const TEMPLATE_PLACEHOLDERS: Array<{ token: keyof MessageTemplateVariables; label: string }> = [
  { token: 'customerName', label: 'اسم العميلة' },
  { token: 'dressName', label: 'اسم القطعة' },
  { token: 'reservationNumber', label: 'رقم الحجز' },
  { token: 'pickupDate', label: 'تاريخ الاستلام' },
  { token: 'pickupTime', label: 'وقت الاستلام' },
  { token: 'returnDate', label: 'تاريخ الإرجاع' },
  { token: 'returnTime', label: 'وقت الإرجاع' },
  { token: 'remainingAmount', label: 'المبلغ المتبقي' },
  { token: 'accessories', label: 'الملحقات المرفقة' },
  { token: 'brandName', label: 'اسم المعرض' },
];

export const DEFAULT_MESSAGE_TEMPLATES: MessageTemplates = {
  pickup_tomorrow: 'مرحباً {{customerName}}،\n'
    + 'نذكّركِ بموعد استلام {{dressName}} غداً {{pickupDate}} الساعة {{pickupTime}}.\n'
    + '{{accessories}}رقم الحجز: {{reservationNumber}}\n\n{{brandName}}',

  return_tomorrow: 'مرحباً {{customerName}}،\n'
    + 'نذكّركِ بموعد إرجاع {{dressName}} غداً {{returnDate}} الساعة {{returnTime}}.\n'
    + '{{accessories}}رقم الحجز: {{reservationNumber}}\n\n{{brandName}}',

  overdue_return: 'مرحباً {{customerName}}،\n'
    + 'نودّ تذكيركِ بأن موعد إرجاع {{dressName}} كان {{returnDate}} ولم نستلم القطعة بعد.\n'
    + '{{accessories}}نرجو التواصل معنا لترتيب الإرجاع وتفادي رسوم التأخير.\n'
    + 'رقم الحجز: {{reservationNumber}}\n\n{{brandName}}',

  outstanding_balance: 'مرحباً {{customerName}}،\n'
    + 'نذكّركِ بوجود مبلغ متبقٍ على الحجز {{reservationNumber}} بقيمة {{remainingAmount}}.\n'
    + 'يسعدنا استقبالكِ لتسوية المبلغ في أي وقت خلال ساعات العمل.\n\n{{brandName}}',
};

const REMINDER_KINDS: ReminderKind[] = ['pickup_tomorrow', 'return_tomorrow', 'overdue_return', 'outstanding_balance'];

/** Longest a single message may be, so a template cannot break the hand-off. */
export const MAX_TEMPLATE_LENGTH = 1200;

function normalizeTemplates(value?: Partial<MessageTemplates>): MessageTemplates {
  const result = {} as MessageTemplates;
  REMINDER_KINDS.forEach((kind) => {
    const candidate = value?.[kind];
    // An empty template would send a blank WhatsApp message under the
    // showroom's name, so it falls back rather than being honoured.
    result[kind] = typeof candidate === 'string' && candidate.trim()
      ? candidate.slice(0, MAX_TEMPLATE_LENGTH)
      : DEFAULT_MESSAGE_TEMPLATES[kind];
  });
  return result;
}

export function getMessageTemplates(): MessageTemplates {
  return normalizeTemplates(readCollection<Partial<MessageTemplates>>(COLLECTION, [DEFAULT_MESSAGE_TEMPLATES])[0]);
}

export function saveMessageTemplates(input: Partial<MessageTemplates>): MessageTemplates {
  REMINDER_KINDS.forEach((kind) => {
    const template = input[kind];
    if (template !== undefined && template.length > MAX_TEMPLATE_LENGTH) {
      throw new Error(`نص الرسالة أطول من الحد المسموح (${MAX_TEMPLATE_LENGTH} حرف).`);
    }
  });

  const normalized = normalizeTemplates({ ...getMessageTemplates(), ...input });
  writeCollection(COLLECTION, [normalized]);
  return normalized;
}

export function resetMessageTemplates(): MessageTemplates {
  writeCollection(COLLECTION, [DEFAULT_MESSAGE_TEMPLATES]);
  return DEFAULT_MESSAGE_TEMPLATES;
}

/**
 * Substitutes `{{placeholder}}` tokens.
 *
 * Unknown tokens are left untouched on purpose: blanking them would hide the
 * owner's typo behind a sentence with a hole in it, while leaving
 * `{{dresName}}` visible in the preview makes the mistake self-evident before
 * anything is sent.
 */
export function renderTemplate(template: string, variables: Partial<MessageTemplateVariables>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = variables[token as keyof MessageTemplateVariables];
    return value === undefined ? match : value;
  });
}

/** Builds the variable set for one reservation. */
export function buildTemplateVariables(input: {
  customerName: string;
  dressName: string;
  reservationNumber: string;
  pickupDate: string;
  pickupTime: string;
  returnDate: string;
  returnTime: string;
  remainingAmount: number;
  accessoryNames: string[];
  brandName: string;
}): MessageTemplateVariables {
  return {
    customerName: input.customerName,
    dressName: input.dressName,
    reservationNumber: input.reservationNumber,
    pickupDate: input.pickupDate,
    pickupTime: input.pickupTime,
    returnDate: input.returnDate,
    returnTime: input.returnTime,
    remainingAmount: formatMoneyOMR(input.remainingAmount),
    // Carries its own trailing newline so a booking with no accessories does
    // not leave a blank line in the middle of the message.
    accessories: input.accessoryNames.length > 0
      ? `الملحقات المرفقة: ${input.accessoryNames.join('، ')}.\n`
      : '',
    brandName: input.brandName,
  };
}
