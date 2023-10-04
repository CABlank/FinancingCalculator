import express, { Request, Response } from 'express';
import { Readable } from 'stream';

function Greet(name: string): string {
return `Hello, ${name}!`;
}

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
UnknownRow: number;
Answer: number;
Rounding: number;
Wal: number;
HWMark: number;
HWMarkDate: string;
Term: number;
IsAmSchedule: boolean;
TotalPayout: number;
IsPmtSchedule: boolean;
Schedule: Schedule[];
Yearend: YearEnd[];
}

interface Schedule {
Type: string;
Date: string;
Cashflow: number;
Principal: number;
Interest: number;
DCFPrincipal: number;
DCFInterest: number;
DCF_Balance: number;
Balance: number;
}

interface YearEnd {
Date: string;
Valuation: number;
Aggregate: number;
YearlyDCFInterest: number;
YearlyInterest: number;
YearlyCumulative: number;
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

interface DeferralData {
PvDate: Date;
From: Date;
To: Date;
CompoundFreq: number;
PaymentFreq: number;
}

interface ScheduleData {
  principal: number;
  accruedInterest: number;
  balance: number;
}

const FreqMap: { [key: string]: number } = {
Monthly: 12,
Quarterly: 4,
SemiAnnual: 2,
Annual: 1,
Payment: 0,
};



const App = express();
const Port = process.env.PORT || 3000;
App.set('ViewEngine', 'ejs');

type AnnuityArray = AnnuityArrayItem[];

async function Calculator(req: Request, res: Response) {
try {
const Result = await Calc(req, true);
res.setHeader('ContentType', 'application/json');
res.status(200).json(Result);
} catch (Err) {
console.error(Err);
res.status(403).send(Err.message);
}
}

async function Calc(req: Request, Schedule: boolean): Promise<{ Answer: Answer | undefined; Annuity: Annuity | undefined; Error: Error | null }> {
const Result: { Answer: Answer | undefined; Annuity: Annuity | undefined; Error: Error | null } = {
Answer: undefined,
Annuity: undefined,
Error: null,
};

if (req.headers['ContentLength'] === '0') {
Result.Error = new Error('Please send a request body');
return Result;
}

const AnnuityResponse = await NewAnnuity(req);

if (!AnnuityResponse.Error) {
const Response2 = CalcAnnuity(AnnuityResponse.Annuity, Schedule);
if(Response2) {
    Result.Answer = Response2[0].Answer;
    Result.Error = Response2[1];
}
}

return Result;
}

function GetAnnuityPV(AA: AnnuityArray, D: Date): number {
for (let I = 0; I < AA.length; I++) {
    if (AA[I].Date.getTime() === D.getTime() && AA[I].Kind === -1) {
        return AA[I].Amount;
    }
}
return 0;
}

async function NewAnnuity(req: Request): Promise<{ Error: Error | null; Annuity: Annuity | null }> {
let Annuity: Annuity | null = null;
let Error: Error | null = null;

try {
const AnnuityBuffer: Uint8Array[] = [];
const Readable = req.body as Readable;

for await (const Chunk of Readable) {
    AnnuityBuffer.push(Chunk);
}

const AnnuityData = Buffer.concat(AnnuityBuffer).toString('utf-8');
Annuity = JSON.parse(AnnuityData);
} catch (Err) {
Error = Err;
}

return { Error, Annuity };
}

type AnnuityArray = AnnuityArrayItem[];

function CalcAnnuity(Annuity: Annuity | null, Schedule: boolean | null) {
let Err = null;
const Result = {'UnknownRow': 0, 'Answer': null}; // The 'Answer' field was missing a value. I've added null for now, you can update as needed.

if(Annuity) {
let Aa = [];

[Aa, Annuity.AsOf] = NewCashflowArray(Annuity.CashFlows, Annuity.Compounding);
SetStubs(Aa, Annuity);

if (Annuity.Unknown) {
    Result.UnknownRow = -1;
    [Result.Answer, Err] = AmortizeRate(Aa, Annuity);
    Annuity.Effective = Effective(Result.Answer);
} else {
    Result.UnknownRow = GetUnknownRow(Annuity);
    Annuity.DailyRate = Annuity.Nominal / 365;
    [Result.Answer, Err] = AmortizeCF(Aa, Annuity, Result.UnknownRow);
}

if (Err === null) {
    Result.PV = GetAnnuityPV(Aa, Annuity.AsOf);
    if (Result.PV !== 0 && Result.DCFpv === 0) {
    Result.DCFpv = EstimatePV(Aa, Annuity.Effective);
    }

    Annuity.Aggregate = ToFixed(AaAggregate(Aa), 2);
    Result.WAL = CalcWAL(Aa, Annuity.Aggregate);

    if (Schedule) {
    Result.AmSchedule = CreateAmSchedule(Result, Aa, Annuity, PaymentCount(Annuity.CashFlows));
    Result.YeValuations = YearEndSummary(Aa, Annuity, Result);
    }
    Result.TotalPayout = Annuity.Aggregate;
}
}
return [Result, Err];
}

function NewCashflowArray(Pmts: CashFlow[], Compounding: string): [AnnuityArray, Date] {
let PFreq: number, CfType: number, I: number;
let FirstPaymentDate: Date, AsOf: Date;
let SortRequired = false, AsOfBool = false;
const Aa: AnnuityArray = new Array<AnnuityArrayItem>(PaymentCount(Pmts));

for (let Row = 0; Row < Pmts.length; Row++) {
    const V = Pmts[Row];
    FirstPaymentDate = dateutils.ParseDateFromString(V.First);
    let Amount = V.Amount;
    let Tracker = Amount;

    if (V.COLA !== 0 && V.ColaPeriods === 0) {
    Pmts[Row].ColaPeriods = FreqMap[V.Frequency];
    }

    if (V.CfType === "Invest") {
    CfType = -1;
    if (!AsOfBool) {
        AsOf = FirstPaymentDate;
        AsOfBool = true;
    }
    } else {
    CfType = 1;
    }

    PFreq = FreqMap[V.Frequency] || FreqMap[Compounding];
    PFreq = 12 / PFreq;
    const Escrow = V.Escrow;

    if (I > 0 && !SortRequired) {
    SortRequired = dateutils.CompareDates(FirstPaymentDate, Aa[I - 1].Date);
    }

    for (let J = 0; J < V.Number; J++) {
    Aa[I] = {
        RowID: Row,
        Date: dateutils.AddMonths(FirstPaymentDate, J * PFreq),
        Amount: Amount,
        Kind: CfType,
        Escrow: Escrow,
        CaseCode: V.CaseCode,
        Owner: V.Buyer,
        PmtNmbr: I,
        Freq: V.Frequency,
    };
    I++;

    if ((J + 1) * PFreq % 12 === 0 && V.COLA !== 0 && J !== V.Number - 1) {
        Tracker *= 1.0 + V.COLA;
        Amount = ToFixed(Tracker, 2); // Define ToFixed function as needed
    }
    }
}

if (SortRequired) {
    Aa.sort((A, B) => {
    if (A.Date < B.Date) {
        return -1;
    } else if (A.Date > B.Date) {
        return 1;
    } else {
        return A.RowID - B.RowID;
    }
    });
}

return [Aa, AsOf];
}
function GetInvestmentValue(Annuity: Annuity): number {
for (let CashFlow of Annuity.CashFlows) {
if (CashFlow.CfType === "Invest") {
    return CashFlow.Amount;
}
}
return 0;
}

function LastPaymentDate(FirstPaymentDate: Date, NumberPmts: number, Frequency: string): Date {
if (!FreqMap[Frequency]) {
return FirstPaymentDate;
}
return AddMonths(FirstPaymentDate, (NumberPmts - 1) * (12 / FreqMap[Frequency]));
}

function PaymentCount(Cfs: CashFlow[]): number {
return Cfs.reduce((Sum, Cf) => Sum + Cf.Number, 0);
}

function StringifyWalTerm(R: Answer): [string, string] {
return [
R.Term.ToFixed(1),
R.Wal.ToFixed(1),
];
}

function CalcWAL(Aa: AnnuityArrayItem[], Start: Date): number {
let WalAgg = 0;
let Aggregate = 0;
for (let V of Aa) {
if (V.Date < Start) {
    continue;
}
const DayDiff = DifferenceInDays(V.Date, Start);
Aggregate += V.Amount;
WalAgg += DayDiff * V.Amount;
}
return ToFixed(WalAgg / Aggregate / 365, 1);
}

function CalcWALWithAggregate(Aa: AnnuityArrayItem[], Aggregate: number): number {
let WalAgg = 0;
let DayDiff: number;
let WalDate: Date | null = null;
for (let V of Aa) {
    if (V.Kind !== 1) {
    if (!WalDate) {
        WalDate = V.Date;
    }
    continue;
    }
    DayDiff = DifferenceInDays(V.Date, WalDate!);
    WalAgg += DayDiff * V.Amount;
}


function DiffDays(a: Date, b: Date): number {
  const differenceInMilliseconds = a.getTime() - b.getTime();
  const differenceInDays = Math.floor(differenceInMilliseconds / (1000 * 3600 * 24));
  return differenceInDays;
}

return ToFixed(WalAgg / Aggregate / 365, 1);
}

function Nominal(Rate: number): number {
return 12.0 * (Math.pow(Rate + 1.0, 1.0 / 12.0) - 1.0);
}

function Effective(Rate: number): number {
return Math.pow(1.0 + (Rate / 12), 12) - 1;
}

function AaAggregate(Aa: AnnuityArrayItem[]): number {
return Aa.reduce((Agg, V) => V.Kind === 1 ? Agg + V.Amount : Agg, 0);
}

function GetInvestmentDate(Aa: AnnuityArrayItem[]): Date {
for (let Item of Aa) {
    if (Item.Kind === -1) {
    return Item.Date;
    }
}
return Aa[Aa.length - 1].Date;
}

function EstimatePV(Aa: AnnuityArrayItem[], Rate: number): number {
let PvEstimate = 0;
const PvDate = GetInvestmentDate(Aa);
for (let I = 0; I < Aa.length; I++) {
    const V = Aa[I];
    if (PvDate.getTime() === V.Date.getTime() && V.Kind === -1) {
    continue;
    } else {
    const Period = V.DcfStubPeriods + (V.DcfStubDays / 365 * 12);
    Aa[I].DiscountFactor = (1 / Math.pow(1 + Rate, Period / 12)) * V.Kind;
    Aa[I].DCF = ToFixed(Aa[I].DiscountFactor * Aa[I].Amount, 2);
    PvEstimate += Aa[I].DCF;
    }
}
return PvEstimate;
}

function Amortize(Aa: AnnuityArrayItem[], Annuity: Annuity): number {
let Interest: number = 0;
let Balance: number = 0;

for (const V of Aa) {
    Interest = V.StubDays * Annuity.DailyRate * Balance;
    Balance += Interest;
    Balance *= Math.pow(1 + Annuity.Nominal / FreqMap[Annuity.Compounding], V.StubPeriods);
    Balance -= V.Amount * V.Kind;
}

return Balance;
}

function SetStubs(Aa: AnnuityArrayItem[], Annuity: Annuity): void {
const Compounding: number = 12 / FreqMap[Annuity.Compounding];
let PayPeriod: number;

const Data: DeferralData = {
    PvDate: Aa[0].Date,
    From: Aa[0].Date,
    To: Aa[0].Date,
    CompoundFreq: Compounding,
    PaymentFreq: 1,
};

for (let I = 0; I < Aa.length; I++) {
    const V = Aa[I];
    if (I === 0 || Aa[0].Date === V.Date) {
        Aa[I].StubDays = Aa[I].StubPeriods = Aa[I].DcfStubDays = Aa[I].DcfStubPeriods = 0;
        continue;
    }

    Data.From = Aa[I - 1].Date;
    Data.To = V.Date;
    Data.PaymentFreq = FreqMap[Annuity.CashFlows[V.RowID].Frequency] || 0;
    if (Data.PaymentFreq !== 0) {
        Data.PaymentFreq = 12 / Data.PaymentFreq;
    } else {
        Data.PaymentFreq = 1;
    }

    if (V.RowID === Aa[I - 1].RowID) {
        PayPeriod = Data.PaymentFreq / Data.CompoundFreq;
        Aa[I].StubDays = 0;
        Aa[I].StubPeriods = PayPeriod;
    } else {
        [Aa[I].StubDays, Aa[I].StubPeriods] = CreateStubs(Data);
    }

    Data.From = Data.PvDate;
    [Aa[I].DcfStubDays, Aa[I].DcfStubPeriods] = CreateStubs(Data);
}
}

function CreateStubs(Data: DeferralData): [number, number] {
    let CountMonths = Data.To.getMonth() - Data.From.getMonth() + (12 * (Data.To.getFullYear() - Data.From.getFullYear()));
    if (CountMonths !== 0) {
        if (Data.To.getDate() < Data.From.getDate()) {
            CountMonths--;
            if (Data.To.getDate() === Dateutils.DaysInMonth(Data.To.getFullYear(), Data.To.getMonth())) {
                CountMonths++;
            }
        }
    }
    const CountPeriods = Math.floor(CountMonths / Data.CompoundFreq);
    const Dt = Dateutils.AddMonths(Data.To, -CountPeriods * Data.CompoundFreq);
    const StubDays = Dateutils.DiffDays(Dt, Data.From);
    return [StubDays, CountPeriods];
  }
  
  async function AmortizeRate(Aa: AnnuityArray, Annuity: Annuity): Promise<[number, Error | null]> {
    let Guess = 0, Balance = 0, Min = -1, Max = 1;
    while (Max - Min > 0.0000001) {
        Guess = (Min + Max) / 2;
        if (Min > 0.99999 || Max < -0.99999) {
            return [0, new Error(`Interest rate out of range error with guessed rate = ${Guess} and annuity pv = ${Annuity.CashFlows[0].Amount}`)];
        }
        Annuity.Nominal = Guess;
        Annuity.DailyRate = Annuity.Nominal / 365;
        Balance = Amortize(Aa, Annuity);
        if (Balance > 0) {
            Max = Guess;
        } else {
            Min = Guess;
        }
    }
    return [Guess, null];
  }
  
  async function AmortizeCF(Aa: AnnuityArray, Annuity: Annuity, UnknownRow: number): Promise<[number, Error | null]> {
    let Guess = 0, Floor = -10000000, Ceiling = 10000000, Iterations = 0;
    let Min: number, Max: number;
    if (Annuity.CashFlows[UnknownRow].CfType === "Invest") {
        Annuity.EstimateDCF = EstimatePV(Aa, Annuity.Effective);
        Min = Annuity.EstimateDCF - (Annuity.EstimateDCF * 0.009);
        Max = Annuity.EstimateDCF + (Annuity.EstimateDCF * 0.009);
        console.log("Estimated NPV for", Annuity.DCFCode, Annuity.EstimateDCF, "Rate:", Annuity.Effective, Min, Max);
    } else {
        Min = Floor;
        Max = Ceiling;
    }
    while (Max - Min > 0.001) {
        Iterations++;
        Guess = (Min + Max) / 2;
        if (Max < Floor + 0.01 || Min > Ceiling - 0.01) {
            return [0, new Error("ERROR - the cash flow has iterated beyond the max/min range - check that your variables are correct")];
        }
        UpdateAnnuity(Aa, Guess, Annuity, UnknownRow);
        Balance = Amortize(Aa, Annuity);
        if ((Annuity.CashFlows[UnknownRow].CfType === "Invest" && Balance < 0) || (Annuity.CashFlows[UnknownRow].CfType !== "Invest" && Balance > 0)) {
            Min = Guess;
        } else {
            Max = Guess;
        }
    }
    console.log("Number of iterations:", Iterations);
    if (Annuity.CashFlows[UnknownRow].COLA !== 0) {
        UpdateAnnuity(Aa, ToFixed(Guess, 2), Annuity, UnknownRow);
    }
    return [ToFixed(Guess, 2), null];
  }
  