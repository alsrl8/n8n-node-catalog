// Auto-generated from n8n source. Do not edit manually.

/** Schedule Trigger */
declare namespace scheduleTrigger {

  namespace V1_3 {
    interface IntervalItem {
      /** Trigger Interval */
      field?: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'cronExpression';
      /** Number of seconds between each workflow trigger (when field = 'seconds') */
      secondsInterval?: number;
      /** Number of minutes between each workflow trigger (when field = 'minutes') */
      minutesInterval?: number;
      /** Number of hours between each workflow trigger (when field = 'hours') */
      hoursInterval?: number;
      /** Number of days between each workflow trigger (when field = 'days') */
      daysInterval?: number;
      /** Would run every week unless specified otherwise (when field = 'weeks') */
      weeksInterval?: number;
      /** Would run every month unless specified otherwise (when field = 'months') */
      monthsInterval?: number;
      /** The day of the month to trigger, 1-31 (when field = 'months') */
      triggerAtDayOfMonth?: number;
      /** Trigger on Weekdays (when field = 'weeks') */
      triggerAtDay?: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
      /** The hour of the day to trigger (when field = 'days' | 'weeks' | 'months') */
      triggerAtHour?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23;
      /** The minute past the hour to trigger, 0-59 (when field = 'hours' | 'days' | 'weeks' | 'months') */
      triggerAtMinute?: number;
      /** Cron expression (when field = 'cronExpression') */
      expression?: string;
    }

    interface Params {
      /** Trigger Rules */
      rule?: {
        interval: IntervalItem[];
      };
    }
  }
}

export = scheduleTrigger;
