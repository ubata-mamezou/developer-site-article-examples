interface BaseCustomer {
  id: string;
  name: string;
  address: string;
}
class IndividualCustomer implements BaseCustomer {
  // biome-ignore format: keep one line
  constructor(
    public id: string,
    public name: string,
    public address: string,
    public personalId: string,
  ) {}
}
class CorporateCustomer implements BaseCustomer {
  constructor(
    public id: string,
    public name: string,
    public address: string,
    public registrationNumber: string,
  ) {}
}
const checkCustomer = (customer: BaseCustomer) => {
  console.log(`Customer ID: ${customer.id}, Name: ${customer.name}`);
};
const ic = new IndividualCustomer("1", "John Doe", "123-45-6789", "987654321");
checkCustomer(ic);
const cc = new CorporateCustomer("2", "Acme Corp", "987654321", "123-45-6789");
checkCustomer(cc);

//---継承関係のない型を引数に指定してみると
type OriginalCustomer = {
  id: string;
  name: string;
  address: string;
  dummy: string;
};
const oc: OriginalCustomer = {
  id: "3",
  name: "Jane Doe",
  address: "456-78-9012",
  dummy: "dummy",
};
checkCustomer(oc); // 構造が一致しているためエラーにならない

//---Brand属性の利用
interface BaseCustomerWithBland {
  __brand: "BaseCustomer";
  id: string;
  name: string;
  address: string;
}
class IndividualCustomerWithBrand implements BaseCustomerWithBland {
  __brand = "BaseCustomer" as const;
  constructor(
    public id: string,
    public name: string,
    public address: string,
    public personalId: string,
  ) {}
}
const checkCustomerWithBrand = (customer: BaseCustomerWithBland) => {
  console.log(`Customer ID: ${customer.id}, Name: ${customer.name}`);
};
const icb = new IndividualCustomerWithBrand(
  "1",
  "John Doe",
  "123-45-6789",
  "987654321",
);
checkCustomerWithBrand(icb);

//Brand属性を持たせれると・・・
const ocb = {
  __brand: "BaseCustomer" as const,
  id: "3",
  name: "Jane Doe",
  address: "456-78-9012",
  dummy: "dummy",
};
checkCustomerWithBrand(ocb); // 構造が一致しているため、エラーにならない

//BrandTypeを作ってみると・・・
type BrandType<K, T> = K & { __brand: T };
type OriginalCustomerWithBrand2 = BrandType<
  {
    id: string;
    name: string;
    address: string;
    dummy: string;
  },
  "BaseCustomer"
>;
const ocb2 = {
  id: "4",
  name: "Jack Doe",
  address: "789-01-2345",
  dummy: "dummy",
} as OriginalCustomerWithBrand2;
checkCustomerWithBrand(ocb2); // 構造が一致しているため、エラーにならない

//---protectedで種類を示すプロパティを持たせる
abstract class BaseCustomerWithType {
  protected abstract classType: string;
  constructor(
    public id: string,
    public name: string,
    public address: string,
  ) {}
}
class IndividualCustomerWithType extends BaseCustomerWithType {
  protected classType = "individualType";
  constructor(
    id: string,
    name: string,
    address: string,
    public personalId: string,
  ) {
    super(id, name, address);
  }
}
const checkCustomerWithType = (customer: BaseCustomerWithType) => {
  console.log(`Customer ID: ${customer.id}, Name: ${customer.name}`);
};

const ic2 = new IndividualCustomerWithType(
  "1",
  "John Doe",
  "123-45-6789",
  "987654321",
);
checkCustomerWithType(ic2);
// const oc2 = {
//   classType: "individualType",
//   id: "3",
//   name: "Jane Doe",
//   address: "456-78-9012",
//   dummy: "dummy",
// };
// checkCustomerWithType({...oc2, classType: "individualType"}); // error: 継承関係にないところからclassTypeを設定できないため
// checkCustomerWithType(oc2); // error: 継承関係にないところからclassTypeを設定できないため
