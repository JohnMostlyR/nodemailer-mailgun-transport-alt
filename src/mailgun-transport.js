const Mailgun = require('mailgun-js');
const packageData = require('../package.json');

const whitelistExact = [
    'from',
    'to',
    'cc',
    'bcc',
    'subject',
    'text',
    'html',
    'attachment',
    'inline',
    'recipient-variables',
    'o:tag',
    'o:campaign',
    'o:dkim',
    'o:deliverytime',
    'o:testmode',
    'o:tracking',
    'o:tracking-clicks',
    'o:tracking-opens',
    'o:require-tls',
    'o:skip-verification',
    'X-Mailgun-Variables'
];
const whitelistPrefix = [
    'h:',
    'v:'
];
const transformList = [
    {
        nodemailerKey: 'replyTo',
        mailgunKey: 'h:Reply-To'
    }
];

class MailgunTransport {
    constructor(options = {}) {
        const {
            auth: {
                api_key = '',
                domain = '',
            },
            proxy = false,
            host = 'api.mailgun.net',
            protocol = 'https',
            port = 443,
        } = options;
        this.name = 'Mailgun';
        this.version = packageData.version;

        this.mailgun = Mailgun({
            apiKey: api_key,
            domain,
            proxy,
            host,
            protocol,
            port,
        });

        this.messages = this.mailgun.messages();
    }

    // convert address objects or array of objects to strings if present
    convertAddressesToStrings(mailData) {
        const convertedAddresses = mailData;

        ['from', 'to', 'cc', 'bcc', 'replyTo'].forEach((target) => {
            const targetSendToMailData = mailData[target];
            if (targetSendToMailData !== null && (typeof targetSendToMailData === 'object' || Array.isArray(targetSendToMailData))) {
                const targets = [];
                const targetSendToArray = typeof targetSendToMailData === 'object' ? [targetSendToMailData] : targetSendToMailData;

                targetSendToArray.forEach((targetSendTo) => {
                    if (Array.isArray(targetSendTo)) {
                        targetSendTo.forEach((sendTo) => {
                            if (typeof sendTo === 'object' && sendTo.address) {
                                const sendToString = sendTo.name ? `${sendTo.name} <${sendTo.address}>` : sendTo.address;
                                targets.push(sendToString);
                            } else if (typeof sendTo === 'string') {
                                targets.push(sendTo);
                            }
                        });
                    } else if (targetSendTo.address) {
                        const sendToString = targetSendTo.name ? `${targetSendTo.name} <${targetSendTo.address}>` : targetSendTo.address;
                        targets.push(sendToString);
                    }
                });

                convertedAddresses[target] = targets.join();
            }
        });

        return convertedAddresses;
    };

    static transformMailData(mailData) {
        const transformedMailData = mailData;
        delete transformedMailData.headers;

        for (const { nodemailerKey, mailgunKey } of transformList) {
            if (mailData[nodemailerKey]) {
                transformedMailData[mailgunKey] = mailData[nodemailerKey];
                delete transformedMailData[nodemailerKey];
            }
        }

        return transformedMailData;
    };

    // convert nodemailer attachments to mailgun-js attachments
    resolveAttachments(mailData) {
        const resolvedAttachments = mailData;
        const { attachments } = resolvedAttachments;

        if (attachments) {
            const attachmentList = [];
            const inlineList = [];
            let mailgunAttachment;
            let data;

            for (const attachment of attachments) {
                const {
                    content,
                    encoding,
                    path,
                    cid,
                    filename,
                    contentType = undefined,
                    knownLength = undefined,
                } = attachment;

                // mailgunjs does not encode content string to a buffer
                if (typeof content === 'string') {
                    data = Buffer.from(content, encoding);
                } else {
                    data = content || path || undefined;
                }

                mailgunAttachment = new this.mailgun.Attachment({
                    data,
                    filename: cid || filename || undefined,
                    contentType,
                    knownLength,
                });

                if (cid) {
                    inlineList.push(mailgunAttachment);
                } else {
                    attachmentList.push(mailgunAttachment);
                }
            }

            resolvedAttachments.attachment = attachmentList;
            resolvedAttachments.inline = inlineList;
            delete resolvedAttachments.attachments;
        }

        return resolvedAttachments;
    };

    sendMail(mailData) {
        return new Promise((resolve, reject) => {
            const options = Object.keys(mailData)
                .filter(key => whitelistExact.find(whitelistExactKey => whitelistExactKey === key) || whitelistPrefix.find(whitelistPrefixKey => key.startsWith(whitelistPrefixKey)))
                .reduce((obj, key) => {
                    obj[key] = mailData[key];
                    return obj;
                }, {});

            this.messages.send(options, (err, data) => {
                if (data) {
                    data.messageId = data.id;
                }
                if (err) {
                    reject(err);
                }
                resolve(data);
            });
        });
    };

    send(mail, callback) {
        const mailDataWithConvertedAddresses = this.convertAddressesToStrings(mail.data);
        const mailDataWithTransformedMailData = MailgunTransport.transformMailData(mailDataWithConvertedAddresses);
        const mailDataWithResolvedAttachments = this.resolveAttachments(mailDataWithTransformedMailData);

        this.sendMail(mailDataWithResolvedAttachments)
            .then((data) => {
                callback(null, data);
            })
            .catch((err) => {
                callback(err);
            });
    }
}

module.exports = function (options) {
    return new MailgunTransport(options);
};
