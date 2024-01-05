const {
  BaseKonnector,
  requestFactory,
  errors,
  log
} = require('cozy-konnector-libs')
const moment = require('moment')

const baseUrl =
  'https://cloud.api.maif.fr/build-cozy/vieprevoyance/contrats/v2/contrats_detenus'

module.exports = new BaseKonnector(start)

async function start(fields, cozyParameters) {
  const {
    dataCollectApiKey,
    maifVieApiKey,
    dataCollectApiUrl
  } = cozyParameters.secret
  const { id, secret } = fields

  const requestOptions = {
    cheerio: false,
    json: true,
    auth: {
      user: 'epa-apikey',
      pass: dataCollectApiKey
    }
    // debug: true,
  }

  if (id && secret) {
    Object.assign(requestOptions, {
      headers: {
        'Epa-Auth-Id': id,
        'Epa-Auth-Secret': secret
      }
    })
  }

  const requestDataCollect = requestFactory(requestOptions)

  const { slug } = parseUrl(process.env.COZY_URL)

  const baseUrlDataCollect = dataCollectApiUrl + '/api/data-collect'

  let person
  try {
    person = await requestDataCollect.get(
      `${baseUrlDataCollect}/persons/${slug}`
    )
  } catch (err) {
    if (err.statusCode === 401) {
      log('error', '401: ' + err.message)
      throw new Error(errors.LOGIN_FAILED)
    } else if (err.statusCode === 404) {
      log('warn', '404: ' + err.message)
      log('warn', 'Found no person')
      throw new Error(errors.LOGIN_FAILED.NO_PERSON)
    } else {
      log('error', err.statusCode + ': ' + err.message)
      throw new Error(errors.VENDOR_DOWN)
    }
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

  let contrats
  try {
    contrats = await requestMaifVie.get(baseUrl, {
      qs: { identifiantPersonne: identifiant }
    })
  } catch (err) {
    log('error', err.message)
    throw new Error('VENDOR_DOWN.MAIF_VIE_REQUEST_FAILED')
  }

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

function parseUrl(url) {
  const matching = url.match(/^https?:\/\/(.*)\.(.*)\.(.*)$/)
  if (!matching) {
    log('error', `wrong COZY_URL : ${process.env.COZY_URL}`)
    throw new Error(errors.VENDOR_DOWN)
  }

  const slug = matching[1]
  log('info', `Found slug ${slug}`)

  return { slug }
}
