process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://11cc1acc137f4403aabee906bc5304f6@sentry.cozycloud.cc/142'

const {
  BaseKonnector,
  requestFactory,
  errors,
  log
} = require('cozy-konnector-libs')
const moment = require('moment')

const baseUrl =
  'https://cloud.api.maif.fr/build-cozy/vieprevoyance/contrats/v2/contrats_detenus'

const baseUrlDataCollect =
  'http://build-epa-maif.francecentral.cloudapp.azure.com/api/data-collect'

module.exports = new BaseKonnector(start)

async function start(fields, cozyParameters) {
  const { id, secret } = cozyParameters.secret

  const requestDataCollect = requestFactory({
    cheerio: false,
    json: true,
    auth: {
      user: id,
      pass: secret
    }
    // debug: true,
  })

  const slug = getSlugFromDomain()

  let person
  try {
    person = await requestDataCollect.get(
      `${baseUrlDataCollect}/persons/${slug}`
    )
  } catch (err) {
    log('error', err.message)
    throw new Error(errors.LOGIN_FAILED)
  }

  const { identifiantMaifVie } = person
  const { apikey } = cozyParameters.secret
  let requestMaifVie = requestFactory({
    // debug: true,
    cheerio: false,
    json: true,
    headers: {
      'x-api-key': apikey
    }
  })

  const contrats = await requestMaifVie.get(baseUrl, {
    qs: { identifiantMaifVie }
  })

  let nbFetchedFile = 0
  for (const partenaire of contrats.personnesPartenaires) {
    for (const contratVie of partenaire.contratsVie) {
      if (contratVie.lettreCleContratVie && contratVie.numeroContratVie)
        await this.saveFiles(
          [
            {
              filename: `${contratVie.lettreCleContratVie}${contratVie.numeroContratVie}.pdf`,
              fileurl: `${baseUrl}/${contratVie.lettreCleContratVie}${contratVie.numeroContratVie}/releves_annuels?identifiantAdherent=${partenaire.referenceClient}`,
              fetchFile: entry => {
                nbFetchedFile++
                return requestMaifVie(entry.fileurl)
              }
            }
          ],
          fields
        )
    }
  }

  if (nbFetchedFile > 0) {
    await this.updateOrCreate(
      [
        {
          type: 'releve',
          tags: ['nouveau releve'],
          title: `Vous avez un nouveau relevé`,
          content: `Vous avez un nouveau relevé pour l'année ${moment().format(
            'YYYY'
          )}`,
          metadata: [
            {
              label: 'pushnotif',
              value: 'true'
            }
          ]
        }
      ],
      'fr.maif.events'
    )
  }
}

function getSlugFromDomain() {
  const matching = process.env.COZY_URL.match(/^https?:\/\/(.*)\.(.*)\.(.*)$/)
  if (!matching) {
    log('error', `wrong COZY_URL : ${process.env.COZY_URL}`)
    throw new Error(errors.VENDOR_DOWN)
  }

  const slug = matching[1]
  log('info', `Found slug ${slug}`)
  return slug
}
