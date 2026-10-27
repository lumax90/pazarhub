/** Contract-shaped responses for private test accounts. Never contacts a provider. */
export function marketplaceFixture(fallback?: typeof fetch) {
  const createAccount = () => {
    const now = Date.now() - 86400000
    return {
      answerUncertain: false,
      claimUncertain: false,
      autoAnswer: true,
      answerWrites: [] as string[],
      claimWrites: [] as string[][],
      claimIssues: [] as { ids: string[]; reason: string; description: string; files: string[] }[],
      requests: [] as string[],
      question: {
        id: 2001,
        text: 'Bu ürün bulaşık makinesinde yıkanabilir mi?',
        productName: 'Seramik kupa',
        showUserName: false,
        userName: 'Hidden name',
        status: 'WAITING_FOR_ANSWER',
        creationDate: now,
        answer: null as null | { text: string; creationDate: number },
        rejectedAnswer: null as null | { text: string; creationDate: number },
        rejectedDate: null as number | null,
      },
      claim: {
        id: 'claim-2001',
        orderNumber: 'TY-ORDER-1',
        claimDate: now,
        cargoTrackingNumber: 'TRACK-TEST',
        items: [
          {
            orderLine: {
              id: 301,
              productName: 'Seramik kupa',
              barcode: '8690000001',
              merchantSku: 'KUPA-BEYAZ',
              price: 100,
            },
            claimItems: [
              {
                id: 'claim-line-1',
                claimItemStatus: { name: 'WaitingInAction' },
                customerClaimItemReason: { name: 'Ürün beklentimi karşılamadı' },
                customerNote: 'İade etmek istiyorum.',
              },
              {
                id: 'claim-line-2',
                claimItemStatus: { name: 'WaitingInAction' },
                customerClaimItemReason: { name: 'Ürün beklentimi karşılamadı' },
                customerNote: '',
              },
            ],
          },
        ],
      },
      settlements: [
        {
          id: '725041340',
          transactionDate: now,
          transactionType: 'Satış',
          debt: 0,
          credit: 449.99,
          commissionAmount: 67.4985,
          sellerRevenue: 382.4915,
          orderNumber: 'TY-ORDER-1',
          paymentOrderId: 112360,
          barcode: '8690000001',
        },
        {
          id: '725041335',
          transactionDate: now,
          transactionType: 'Satış',
          debt: 0,
          credit: 699.99,
          commissionAmount: 104.9985,
          sellerRevenue: 594.9915,
          orderNumber: 'TY-ORDER-2',
          paymentOrderId: 112360,
          barcode: '8690000002',
        },
      ] as Record<string, unknown>[],
      other: [
        {
          id: '725041340',
          transactionDate: now,
          transactionType: 'DeductionInvoices',
          debt: 7.483,
          credit: 0,
          commissionAmount: null,
          sellerRevenue: null,
          paymentOrderId: 112360,
        },
        {
          id: '1639160',
          transactionDate: now,
          transactionType: 'Ödeme',
          debt: 970,
          credit: 0,
          commissionAmount: null,
          sellerRevenue: null,
          paymentOrderId: 112360,
        },
      ] as Record<string, unknown>[],
      payouts: [
        { id: 112360, status: 'PAID', amount: 970, payoutDate: now, paymentType: 'PAYMENT' },
      ] as Record<string, unknown>[],
    }
  }
  const accounts = new Map<string, ReturnType<typeof createAccount>>()
  const account = (seller: string) => {
    let value = accounts.get(seller)
    if (!value) {
      value = createAccount()
      accounts.set(seller, value)
    }
    return value
  }
  const response = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname,
      method = init?.method ?? 'GET',
      seller = /\/sellers\/(\d+)/.exec(path)?.[1]
    if (path.endsWith('/claim-issue-reasons'))
      return response([
        { id: 51, name: 'İade gelen ürün kullanılmış' },
        { id: 351, name: 'İade paketi boş geldi' },
      ])
    if (!seller || !['/qna/', '/claims', '/finance/'].some((part) => path.includes(part))) {
      if (fallback) return fallback(input, init)
      if (path.endsWith('/products')) return response({ content: [], totalPages: 0 })
      throw new Error(`Unexpected fixture request: ${method} ${path}`)
    }
    const state = account(seller)
    state.requests.push(`${method} ${url.pathname}${url.search}`)
    if (path.endsWith('/questions/filter'))
      return response({ content: [state.question], page: 0, totalPages: 1 })
    if (path.endsWith('/questions/2001') && method === 'GET') return response(state.question)
    if (path.endsWith('/questions/2001/answers') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { text: string }
      state.answerWrites.push(body.text)
      if (state.autoAnswer) {
        state.question.status = 'ANSWERED'
        state.question.answer = { text: body.text, creationDate: Date.now() }
      }
      if (state.answerUncertain) throw new Error('Response lost after answer submission')
      return response({ answerId: 5001 })
    }
    if (path.endsWith('/claims') && method === 'GET')
      return response({ content: [state.claim], page: 0, totalPages: 1 })
    if (path.endsWith('/claims/claim-2001/issue') && method === 'POST') {
      const body = init?.body as FormData,
        ids = String(body.get('claimItemIdList')).split(',')
      state.claimIssues.push({
        ids,
        reason: String(body.get('claimIssueReasonId')),
        description: String(body.get('description')),
        files: body.getAll('files').map((file) => (typeof file === 'string' ? file : file.name)),
      })
      for (const item of state.claim.items[0].claimItems)
        if (ids.includes(item.id)) item.claimItemStatus.name = 'Rejected'
      if (state.claimUncertain) throw new Error('Response lost after rejection request')
      return new Response(null, { status: 200 })
    }
    if (path.endsWith('/claims/claim-2001/items/approve') && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { claimLineItemIdList: string[] }
      state.claimWrites.push(body.claimLineItemIdList)
      for (const item of state.claim.items[0].claimItems)
        if (body.claimLineItemIdList.includes(item.id)) item.claimItemStatus.name = 'Accepted'
      if (state.claimUncertain) throw new Error('Response lost after claim approval')
      return new Response(null, { status: 200 })
    }
    if (path.includes('/finance/')) {
      const source = path.split('/').at(-1),
        page = Number(url.searchParams.get('page') ?? 0)
      const rows =
        source === 'settlements'
          ? state.settlements
          : source === 'otherfinancials'
            ? state.other
            : source === 'payment-order'
              ? state.payouts
              : null
      if (!rows) throw new Error('Unknown financial fixture source')
      const from = Number(url.searchParams.get('startDate') ?? 0),
        to = Number(url.searchParams.get('endDate') ?? Date.now()),
        payment = url.searchParams.get('paymentOrderId')
      const filtered = rows.filter((r) =>
        source === 'payment-order' || payment
          ? source === 'payment-order' || String(r.paymentOrderId) === payment
          : Number(r.transactionDate) >= from && Number(r.transactionDate) <= to,
      )
      const size = source === 'settlements' ? 1 : 500
      return response({
        content: filtered.slice(page * size, (page + 1) * size),
        page,
        totalPages: Math.ceil(filtered.length / size),
        totalElements: filtered.length,
      })
    }
    throw new Error(`Unexpected marketplace fixture request: ${method} ${path}`)
  }
  return { account, fetcher }
}
