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

function addMonths(date: Date, months: number): Date {
  date.setMonth(date.getMonth() + months);
  return date;
}

function parseDateFromString(dateStr: string): Date {
  return new Date(dateStr);
}




function NewCashflowArray(pmts: CashFlow[], compounding: string): [AnnuityArray, Date | undefined] {
  const FreqMap: { [key: string]: number } = {
      "Monthly": 12,
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

    if (v.cfType === "Invest") {
        cfType = -1;
        if (!asOf) {
            asOf = firstPaymentDate;
        }
    } else {
        cfType = 1;
    }
    
    console.log(`Processing cash flow of type: ${v.cfType} (kind: ${cfType})`);

      pFreq = FreqMap[v.frequency] || 0;
      if (pFreq === 0) {
          pFreq = FreqMap[compounding];
      }
      pFreq = 12 / pFreq;
      const escrow = v.escrow;

      for (let j = 0; j < v.number; j++) {
          aa.push({
              rowID: row,
              date: addMonths(firstPaymentDate, j * pFreq),
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

const annuityData: Annuity = {
  cashFlows: [
      {
          first: "2023-01-01",
          amount: 100,
          frequency: "Monthly",
          cfType: "Return",
          number: 12,
          escrow: "",
          caseCode: "",
          buyer: ""
      }
  ],
  compounding: "Monthly"
};

const result = CalcAnnuity(annuityData);
console.log(result);
