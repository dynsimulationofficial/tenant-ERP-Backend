import { prisma } from '../config/db';

export class CompanyModel {
  static async findMany() {
    return await prisma.company.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  static async findById(id: string) {
    return await prisma.company.findUnique({
      where: { id },
    });
  }

  static async create(data: {
    name: string;
    legalName?: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    taxId?: string;
    logoUrl?: string;
    currency?: string;
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
    routingNumber?: string;
    branchName?: string;
  }) {
    return await prisma.company.create({
      data: {
        name: data.name,
        legalName: data.legalName,
        email: data.email,
        phone: data.phone,
        website: data.website,
        address: data.address,
        taxId: data.taxId,
        logoUrl: data.logoUrl,
        currency: data.currency || 'USD',
        bankName: data.bankName,
        accountName: data.accountName,
        accountNumber: data.accountNumber,
        routingNumber: data.routingNumber,
        branchName: data.branchName,
      },
    });
  }

  static async updateProfile(id: string, data: any) {
    return await prisma.company.update({
      where: { id },
      data,
    });
  }
}
