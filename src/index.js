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
  const { dataCollectApiKey, maifVieApiKey } = cozyParameters.secret

  const requestDataCollect = requestFactory({
    cheerio: false,
    json: true,
    auth: {
      user: 'epa-apikey',
      pass: dataCollectApiKey
    }
    // debug: true,
  })

  const slug = getSlugFromDomain()

  let person
  try {
    person = await requestDataCollect.get(
      `${baseUrlDataCollect}/persons/${slug}?mock=false`
    )
  } catch (err) {
    log('error', err.message)
    throw new Error(errors.LOGIN_FAILED)
  }

  const { identifiant } = person
  let requestMaifVie = requestFactory({
    // debug: true,
    cheerio: false,
    json: true,
    headers: {
      'x-api-key': maifVieApiKey
    }
  })
  const requestOther = require('request')

  const contrats = await requestMaifVie.get(baseUrl, {
    qs: { identifiantPersonne: identifiant }
  })

  if (
    contrats &&
    contrats.personnesPartenaires &&
    contrats.personnesPartenaires.length === 0
  ) {
    log('warn', 'No maif vie contract found')
  } else if (!contrats) {
    throw new Error('VENDOR_DOWN')
  }

  let fetchedFilesList = []
  for (const partenaire of contrats.personnesPartenaires) {
    for (const contratVie of partenaire.contratsVie) {
      if (contratVie.lettreCleContratVie && contratVie.numeroContratVie)
        await this.saveFiles(
          [
            {
              filename: `Releve_annuel_${moment().format('YYYY')}_${
                contratVie.lettreCleContratVie
              }${contratVie.numeroContratVie}.pdf`,
              fileurl: `${baseUrl}/${contratVie.lettreCleContratVie}${contratVie.numeroContratVie}/releves_annuels?identifiantAdherent=${partenaire.referenceClient}`,
              fetchFile: entry => {
                fetchedFilesList.push(
                  `${contratVie.lettreCleContratVie}${contratVie.numeroContratVie}`
                )
                return requestOther(entry.fileurl, {
                  headers: {
                    'x-api-key': maifVieApiKey
                  }
                })
              }
            }
          ],
          fields,
          {
            requestInstance: requestMaifVie,
            fileIdAttributes: ['fileurl'],
            sourceAccountIdentifier: slug
          }
        )
    }
  }

  for (const numContrat of fetchedFilesList) {
    await this.updateOrCreate(
      [
        {
          personId: identifiant,
          cardId: numContrat,
          type: 'releve',
          tags: ['nouveau releve'],
          title: `Vous avez un nouveau relevé annuel`,
          content: `Vous avez un nouveau relevé annuel pour l'année ${moment().format(
            'YYYY'
          )} et pour le contrat ${numContrat}`,
          metadata: [
            {
              label: 'pushnotif',
              value: 'true'
            }
          ]
        }
      ],
      'fr.maif.events',
      ['cardId', 'personId']
    )
  }
}

function getSlugFromDomain() {
  const matching = process.env.COZY_URL.match(/^https?:\/\/(.*)\.(.*)\.(.*)$/)
  if (!matching) {
    log('error', `wrong COZY_URL : ${process.env.COZY_URL}`)
    throw new Error(errors.VENDOR_DOWN)
  }

  let slug = matching[1]
  slug = slug.substr(0, 3) + slug.substr(3).toUpperCase()
  log('info', `Found slug ${slug}`)
  return slug
}
