function greet(name: string): string {
  return `Hello, ${name}!`;
}

import path from 'path';
import express, { Request, Response } from 'express';
import { Readable } from 'stream';

interface Annuity {
  DCFCode: string;
  Compounding: string;
  Effective: number;
  Nominal: number;
  Label: string;
  DailyRate: number;
  Desc: string;
  Type: string;
  Unknown: boolean;
  UseAmSchedule: boolean;
  EstimateDCF: number;
  AsOf: Date;
  CashFlows: CashFlow[];
  Carrier: string;
  Aggregate: number;
  CustomCF: boolean;
  DocumentRecipient: string;
}

interface CashFlow {
  CaseCode: string;
  ParentChild: string;
  Buyer: string;
  CfType: string;
  First: string;
  Last: string;
  Number: number;
  Amount: number;
  Frequency: string;
  COLA: number;
  ColaPeriods: number;
  Unknown: boolean;
  Escrow: boolean;
}

interface Answer {
  PV: number;
  DCFpv: number;
  DCFRounding: number;
  Rate: number;
  row: number; // Note: In TypeScript, property names are case-sensitive, so "row" instead of "UnknownRow"
  answer: number;
  rounding: number;
  wal: number;
  hwmark: number; // Note: In TypeScript, property names should use camelCase, so "hwmark" instead of "HWMark"
  hwMarkDate: string; // Note: In TypeScript, property names should use camelCase, so "hwMarkDate" instead of "HWMarkDate"
  term: number;
  isamschedule: boolean; // Note: In TypeScript, property names should use camelCase, so "isamschedule" instead of "IsAmSchedule"
  totalPayout: number; // Note: In TypeScript, property names should use camelCase, so "totalPayout" instead of "TotalPayout"
  isPmtSchedule: boolean; // Note: In TypeScript, property names should use camelCase, so "isPmtSchedule" instead of "IsPmtSchedule"
  schedule: Schedule[]; // Assuming "Schedule" is another type you have defined
  yearend: YearEnd[]; // Assuming "YearEnd" is another type you have defined
}
interface Schedule {
  type: string;
  date: string;
  cashflow: number;
  principal: number;
  interest: number;
  dcfprincipal: number;
  dcfinterest: number;
  dcf_balance: number;
  balance: number;
}

interface YearEnd {
  date: string;
  valuation: number;
  aggregate: number; // You can use the same name as in Go
  yearlyDCFInterest: number; // Use camelCase as per TypeScript naming conventions
  yearlyInterest: number;
  yearlyCumulative: number;
}

interface AnnuityArrayItem {
  RowID: number;
  Date: Date;
  Amount: number;
  Kind: number;
  Escrow: boolean;
  CaseCode: string;
  Owner: string;
  PmtNmbr: number;
  Freq: string;
}

interface Annuity {
  Compounding: string;
  CashFlows: CashFlow[];
}

interface DeferralData {
  pvDate: Date;
  from: Date;
  to: Date;
  compoundFreq: number;
  paymentFreq: number;
}


const FreqMap: { [key: string]: number } = {
  Monthly: 12,
  Quarterly: 4,
  'Semi-Annual': 2,
  Annual: 1,
  Payment: 0,
};

const app = express();
const port = process.env.PORT || 3000;
app.set('view engine', 'ejs');

async function calculator(req: Request, res: Response) {
  try {
    const result = await Calc(req, true);

    // Sending JSON response
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(403).send(err.message);
  }
}

async function Calc(req: Request, schedule: boolean): Promise<{ answer: Answer | undefined; annuity: Annuity | undefined; error: Error | null }> {
  const result: { answer: Answer | undefined; annuity: Annuity | undefined; error: Error | null } = {
    answer: undefined,
    annuity: undefined,
    error: null,
  };

  if (req.headers['content-length'] === '0') {
    result.error = new Error('Please send a request body');
    return result;
  }

  const annuityResponse  = await NewAnnuity(req);
  
  if (!annuityResponse.error) {
    const response2 = calcAnnuity(annuityResponse.annuity, schedule);
    if(response2) {
      result.answer = response2.answer;
      result.error = response2.error;
    }
  }

  return result;
}

async function NewAnnuity(req: Request): Promise<{ error: Error | null; annuity: Annuity | null }> {
  let annuity: Annuity | null = null;
  let error: Error | null = null;

  try {
    const annuityBuffer: Uint8Array[] = [];
    const readable = req.body as Readable;

    for await (const chunk of readable) {
      annuityBuffer.push(chunk);
    }

    const annuityData = Buffer.concat(annuityBuffer).toString('utf-8');
    annuity = JSON.parse(annuityData);
  } catch (err) {
    error = err;
  }

  return { error, annuity };
}

function calcAnnuity(annuity: Annuity | null, schedule: boolean | null) {
  let err = null;
  const result = {'UnknownRow': 0, 'Answer': };
  if(annuity) {
    let aa = [];
    
      [aa, annuity.AsOf] = newCashflowArray(annuity.CashFlows, annuity.Compounding);
      setStubs(aa, annuity);
    

    if (annuity.Unknown) {
      result.UnknownRow = -1;
      [result.Answer, err] = amortizeRate(aa, annuity);
      annuity.Effective = effective(result.Answer);
    } else {
      result.UnknownRow = getUnknownRow(annuity);
      annuity.DailyRate = annuity.Nominal / 365;
      [result.Answer, err] = amortizeCF(aa, annuity, result.UnknownRow);
    }

    if (err === null) {
      result.PV = getAnnuityPV(aa, annuity.AsOf);
      if (result.PV !== 0 && result.DCFpv === 0) {
        result.DCFpv = estimatePV(aa, annuity.Effective);
      }

      annuity.Aggregate = toFixed(aaAggregate(aa), 2);
      result.WAL = calcWAL(aa, annuity.Aggregate);

      if (schedule) {
        result.AmSchedule = createAmSchedule(result, aa, annuity, paymentCount(annuity.CashFlows));
        result.YeValuations = yearEndSummary(aa, annuity, result);
      }
      result.TotalPayout = annuity.Aggregate;
    }
  }
  return [result, err];
}

type AnnuityArray = AnnuityArrayItem[];

function newCashflowArray(pmts: CashFlow[], compounding: string): [AnnuityArray, Date] {
  let pFreq: number, cfType: number, i: number;
  let firstPaymentDate: Date, asOf: Date;
  let sortRequired = false, asOfBool = false;
  const aa: AnnuityArray = new Array<AnnuityArrayItem>(PaymentCount(pmts));

  for (let row = 0; row < pmts.length; row++) {
    const v = pmts[row];
    firstPaymentDate = dateutils.ParseDateFromString(v.First);
    let amount = v.Amount;
    let tracker = amount;

    if (v.COLA !== 0 && v.ColaPeriods === 0) {
      pmts[row].ColaPeriods = FreqMap[v.Frequency];
    }

    if (v.CfType === "Invest") {
      cfType = -1;
      if (!asOfBool) {
        asOf = firstPaymentDate;
        asOfBool = true;
      }
    } else {
      cfType = 1;
    }

    pFreq = FreqMap[v.Frequency] || FreqMap[compounding];
    pFreq = 12 / pFreq;
    const escrow = v.Escrow;

    if (i > 0 && !sortRequired) {
      sortRequired = dateutils.CompareDates(firstPaymentDate, aa[i - 1].Date);
    }

    for (let j = 0; j < v.Number; j++) {
      aa[i] = {
        RowID: row,
        Date: dateutils.AddMonths(firstPaymentDate, j * pFreq),
        Amount: amount,
        Kind: cfType,
        Escrow: escrow,
        CaseCode: v.CaseCode,
        Owner: v.Buyer,
        PmtNmbr: i,
        Freq: v.Frequency,
      };
      i++;

      if ((j + 1) * pFreq % 12 === 0 && v.COLA !== 0 && j !== v.Number - 1) {
        tracker *= 1.0 + v.COLA;
        amount = ToFixed(tracker, 2); // Define ToFixed function as needed
      }
    }
  }

  if (sortRequired) {
    aa.sort((a, b) => {
      if (a.Date < b.Date) {
        return -1;
      } else if (a.Date > b.Date) {
        return 1;
      } else {
        return a.RowID - b.RowID;
      }
    });
  }

  return [aa, asOf];
}

function amortize(aa: AnnuityArrayItem[], annuity: Annuity): number {
  let interest: number = 0;
  let balance: number = 0;

  for (const v of aa) {
    interest = v.stubDays * annuity.DailyRate * balance;
    balance += interest;
    balance *= Math.pow(1 + annuity.Nominal / FreqMap[annuity.Compounding], v.stubPeriods);
    balance -= v.Amount * v.Kind;
  }

  return balance;
}

function amortizeRate(aa: AnnuityArrayItem[], annuity: Annuity): [number, Error | null] {
  let guess: number = 0;
  let balance: number = 0;
  let min: number = -1;
  let max: number = 1;

  for (let ok = true; ok; ok = (max - min) > 0.0000001) {
    guess = (min + max) / 2;

    if (min > 0.99999 || max < -0.99999) {
      return [0, new Error(`Interest rate out of range error with guessed rate = ${guess} and annuity pv = ${annuity.CashFlows[0].Amount}`)];
    }

    annuity.Nominal = guess;
    annuity.DailyRate = annuity.Nominal / 365;
    balance = amortize(aa, annuity);

    if (balance > 0) {
      max = guess;
    } else {
      min = guess;
    }
  }

  return [guess, null];
}

function setStubs(aa: AnnuityArrayItem[], annuity: Annuity): void {
  const compounding: number = 12 / FreqMap[annuity.Compounding];
  let payPeriod: number;

  const data: DeferralData = {
    pvDate: aa[0].Date,
    from: aa[0].Date,
    to: aa[0].Date,
    compoundFreq: compounding,
    paymentFreq: 1,
  };

  for (let i = 0; i < aa.length; i++) {
    const v = aa[i];

    if (i === 0 || aa[0].Date.toString() === v.Date.toString()) {
      aa[i].stubDays = 0;
      aa[i].stubPeriods = 0;
      aa[i].dcfStubDays = 0;
      aa[i].dcfStubPeriods = 0;
      continue;
    }

    data.from = aa[i - 1].Date;
    data.to = v.Date;

    if ((data.paymentFreq = FreqMap[annuity.CashFlows[v.RowID].Frequency]) !== 0) {
      data.paymentFreq = 12 / data.paymentFreq;
    } else {
      data.paymentFreq = 1;
    }

    if (v.RowID === aa[i - 1].RowID) {
      payPeriod = data.paymentFreq / data.compoundFreq;
      aa[i].stubDays = 0;
      aa[i].stubPeriods = payPeriod;
    } else {
      [aa[i].stubDays, aa[i].stubPeriods] = createStubs(data);
    }

    data.from = data.pvDate;
    [aa[i].dcfStubDays, aa[i].dcfStubPeriods] = createStubs(data);
  }
}











app.set('views', path.join(__dirname, 'views'));

app.get('/', (req: Request, res: Response) => {
  res.render('index')
});
app.post('/calculator', (req: Request, res: Response) => {
  console.log(req.body)
  
  res.render('index')
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

console.log(greet('John'));