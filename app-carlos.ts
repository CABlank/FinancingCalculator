interface CashFlow {
  first: string;
  amount: number;
  frequency: string;
  cfType: string;
  number: number;
  escrow: string;
  caseCode: string;
  buyer: string;
}

interface CfArray {
  rowID: number;
  date: Date;
  formattedDate: string;
  amount: number;
  kind: number;
  escrow: string;
  caseCode: string;
  owner: string;
  pmtNmbr: number;
  freq: string;
}

type AnnuityArray = CfArray[];

interface Annuity {
  cashFlows: CashFlow[];
  compounding: string;
  asOf?: Date;
}

interface Answer {
  unknownRow?: number;
  answer?: number;
  PV?: number;
  DCFpv?: number;
}





function NewCashflowArray(pmts: CashFlow[], compounding: string): [AnnuityArray, Date | undefined] {
  const FreqMap: { [key: string]: number } = {
      "Monthly": 1,
      // ... Other mappings
  };

  let pFreq: number;
  let cfType: number;
  let firstPaymentDate: Date;
  let asOf: Date | undefined;
  const aa: CfArray[] = [];

  for (let row = 0; row < pmts.length; row++) {
    console.log(`Processing cash flow at row: ${row}`);
    const v = pmts[row];
    firstPaymentDate = parseDateFromString(v.first);
    console.log(`First payment date for row ${row}: ${firstPaymentDate}`);
    let amount = v.amount;

    if (v.cfType === "Return") {
        cfType = -1;
        if (!asOf) {
            asOf = firstPaymentDate;
        }
    } else {
        cfType = 1;
    }
    
    console.log(`Processing cash flow of type: ${v.cfType} (kind: ${cfType})`);

    pFreq = FreqMap[v.frequency];
    if (!pFreq) {
        pFreq = FreqMap[compounding];
    }

    const escrow = v.escrow;

    for (let j = 0; j < v.number; j++) {
      const currentDate = new Date(firstPaymentDate);
      currentDate.setMonth(currentDate.getMonth() + j * pFreq);
  
      aa.push({
        rowID: row,
        date: currentDate,
        formattedDate: formatDateToYYYYMMDD(currentDate),
        amount: amount,
        kind: cfType,
        escrow: escrow,
        caseCode: v.caseCode,
        owner: v.buyer,
        pmtNmbr: row * v.number + j,
        freq: v.frequency
      });
      console.log(`Pushed new cash flow array element for row ${row}, payment number: ${j}`);
  }
  
  }
  aa.sort((a, b) => a.date.getTime() - b.date.getTime() || a.rowID - b.rowID);

  console.log("Final cash flow array:", aa);
  return [aa, asOf];
}





function CalcAnnuity(annuity: Annuity): Answer {
  console.log("Starting CalcAnnuity function with annuity data:", annuity);
  const result: Answer = {};
  let aa: AnnuityArray;
  [aa, annuity.asOf] = NewCashflowArray(annuity.cashFlows, annuity.compounding);

  console.log("Annuity array and asOf date after processing:", aa, annuity.asOf);

  if (annuity.asOf) {
      result.PV = 1000;  // Just an example value
  } else {
      result.answer = 200;  // Another example value
  }
  console.log("Final result of CalcAnnuity:", result);
  return result;
}

function paymentCount(cfs: CashFlow[]): number {
  let sum = 0;
  for (const v of cfs) {
      sum += v.number;
  }
  return sum;
}

function compareDates(now: Date, prior: Date): boolean {
  return prior > now;
}

function addMonths(date: Date, offset: number): Date {
  let newDate = new Date(date);
  newDate.setMonth(date.getMonth() + offset);
  const dayOfMonth = date.getDate();
  if (dayOfMonth > 28) {
      newDate.setDate(28);
  }
  if (dayOfMonth === getDaysInMonth(date) || dayOfMonth > getDaysInMonth(newDate)) {
      newDate.setDate(getDaysInMonth(newDate));
  } else {
      newDate.setDate(dayOfMonth);
  }
  return newDate;
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function toFixed(num: number, precision: number): number {
  const output = Math.pow(10, precision);
  return Math.round(num * output) / output;
}

function before(value: string, a: string): string {
  const pos = value.indexOf(a);
  if (pos === -1) {
      return "";
  }
  return value.substring(0, pos);
}
function parseDateFromString(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function parseInventoryDateFormat(timeString: string): Date {
  // You will need to implement the parsing logic for this format.
  return new Date(timeString); // Placeholder
}

function parseFBDateFormat(timeString: string): Date {
  // You will need to implement the parsing logic for this format.
  return new Date(timeString); // Placeholder
}

function formatDateToYYYYMMDD(date: Date): string {
  let dd: string | number = date.getDate();
  let mm: string | number = date.getMonth() + 1; // January is 0!
  const yyyy: number = date.getFullYear();
  
  if(dd < 10) {
      dd = '0' + dd;
  } 
  
  if(mm < 10) {
      mm = '0' + mm;
  } 

  return `${yyyy}-${mm}-${dd}`;
}

const annuityData: Annuity = {
  cashFlows: [
      {
          first: "2023-01-01",
          amount: 100,
          frequency: "Monthly",
          cfType: "Return",
          number: 6,
          escrow: "",
          caseCode: "",
          buyer: ""
      }
  ],
  compounding: "Monthly"
};

const result = CalcAnnuity(annuityData);
console.log(result);
