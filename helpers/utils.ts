// import * as IbanTools from 'ibantools';

type KeyType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

export class Utils {
  static groupBy<T, U>(list: T[], key: KeyType<T, U>): Map<U, T[]> {
    return list.reduce((map, item) => map.set(item[key] as U, (map.get(item[key] as U) ?? []).concat(item)), new Map<U, T[]>());
  }

  static createRules(rules: any): any {
    for (const property in rules) {
      if (rules[property] instanceof Array) {
        rules[property] = rules[property].reduce((prev: any, curr: any) => Utils.updateObject(prev, curr), {});
      }
    }
    return rules;
  }

  private static updateObject(obj?: any, update?: any): unknown {
    return obj ? { ...obj, ...update } : undefined;
  }

  static formatAmount(amount?: number): string {
    return amount?.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') ?? '';
  }

  static formatAmountCrypto(num: number): string {
    let r = (+num.toPrecision(6)).toFixed(6);
    if (r.match(/\./)) {
      r = r.replace(/\.?0+$/, '');
    }
    return r;
  }

  // static formatIban(iban?: string): string | null {
  //   return IbanTools.friendlyFormatIBAN(iban);
  // }

  static sumUtxoValue(utxos: Array<{ value: number }>): number {
    return utxos.reduce((sum, u) => sum + u.value, 0);
  }

  // A value-less send-max target sweeps whatever UTXO set the transaction is built from. Since
  // that set is now refreshed right before signing, it can contain funds that arrived after the
  // user tapped MAX - sweeping those would send more than the balance the confirm screen showed.
  // Only sweep when the fresh total doesn't exceed what was displayed; a smaller fresh total is
  // fine (e.g. frozen coins are excluded from the sweep by design), and anything else falls back
  // to a fixed-value target, which never sends more than the user confirmed.
  static shouldSendMax(amountSats: number, displayedBalanceSats: number, freshUtxoTotalSats: number): boolean {
    return amountSats === displayedBalanceSats && freshUtxoTotalSats <= amountSats;
  }

  static async withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if ((error as { nonRetryable?: boolean } | null)?.nonRetryable || attempt === attempts) throw error;
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
    throw new Error('unreachable');
  }
}
