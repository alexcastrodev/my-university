---
title: "Let's Encrypt: uma autoridade certificadora automatizada para criptografar toda a Web"
summary: Os construtores do Let's Encrypt descrevem como uma autoridade certificadora gratuita e totalmente automatizada, seu protocolo ACME e seu software foram projetados, o que deu errado no caminho e como ela mudou a adoção de HTTPS na Web.
researchArea: Segurança e privacidade
keywords: https, autoridade certificadora, pki da web, protocolo acme, validação de domínio, certificate transparency
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

O HTTPS protege o tráfego da Web contra escuta e adulteração, mas precisa de um certificado de uma autoridade certificadora (CA) em que os navegadores confiam, e obter um costumava ser difícil. O operador do servidor precisava gerar chaves com ferramentas obscuras, provar o controle do domínio à mão e pagar. Os autores dizem que ainda em 2015 entre 55% e 70% dos carregamentos de página nos navegadores usavam HTTP simples. O preço médio de um certificado de um ano das cinco maiores CAs em 2015 era US$ 178 para um domínio e US$ 766 para um curinga (wildcard).

Este artigo, da equipe que construiu o Let's Encrypt (Josh Aas e onze coautores, ACM CCS 2019), é um relato de experiência. Ele descreve como uma organização sem fins lucrativos construiu uma CA gratuita e automatizada do primeiro pedido até a renovação, como funcionam seu protocolo e seu software, o que mediram sobre o efeito na Web e as lições de segurança que tiraram.

Vale conhecer antes: certificados de chave pública e o que uma CA atesta, o que TLS e HTTPS acrescentam ao HTTP e a diferença entre validação de domínio e validação de organização.

## Contribuição

- **Uma CA gratuita e totalmente automatizada.** A validação de domínio e a emissão são feitas por software, sem exceção manual, o que reduz o custo por certificado ao ponto de oferecê-lo sem cobrança.
- **O ACME,** o protocolo, depois padronizado pelo IETF, pelo qual um cliente pede um certificado, prova o controle de um domínio e renova ou revoga. Existem muitos clientes independentes, inclusive o Certbot, que a equipe criou.
- **O Boulder,** o software da CA, dividido em componentes que rodam de forma independente (a API, a autoridade de registro, a autoridade de validação, a autoridade certificadora, o OCSP) para que o comprometimento de um componente exposto não chegue às chaves de assinatura.
- **Uma medição do impacto** na adoção de HTTPS e no mercado de CAs, e uma discussão das lições de operar o serviço.

## Metodologia

O artigo é um estudo de caso de sistemas e de operações, apoiado em medições. Para o projeto, ele descreve a organização (ISRG), a arquitetura e o protocolo, incluindo os desafios de validação e os controles que limitam o risco (separação de componentes, acesso restrito aos data centers, instâncias redundantes, verificação dos certificados nos logs de Certificate Transparency).

Para o impacto, os autores usam várias fontes: varreduras longitudinais do Censys sobre HTTPS, logs de Certificate Transparency, telemetria do Firefox no canal Beta e varreduras próprias dos nomes encontrados nos logs. A maioria dos números é de janeiro de 2019, com alguma telemetria até setembro de 2019.

## Resultados

Estes são os resultados relatados pelos autores.

- Até 21 de janeiro de 2019, o Let's Encrypt havia emitido 538 milhões de certificados para 223 milhões de nomes de domínio únicos, e tinha 91 milhões de certificados não expirados válidos para 155 milhões de nomes, mais que todas as outras CAs confiáveis para navegadores juntas.
- No pico emite mais de um milhão de certificados por dia em infraestrutura modesta. O maior desafio de escala foi o banco de dados da CA e os dados de log, cerca de 150 GB por dia em setembro de 2019, e não a capacidade de processamento.
- Entre o milhão de sites mais populares que usam HTTPS, sua participação cresceu de cerca de 2% em julho de 2016 para mais de 25% em janeiro de 2019. É usado por 5% dos mil sites mais populares, 20% dos cem mil mais populares e 35% do milhão mais popular. Na telemetria do Firefox Beta, foi de 0,44% dos handshakes TLS completos em março de 2017 para 3,7% em setembro de 2019, uma fatia bem menor que sua participação em sites, porque os sites mais populares usam outras CAs, muitas vezes por certificados de validação de organização ou estendida que o Let's Encrypt não emite.
- Os autores argumentam que o crescimento sustenta a visão deles de que a usabilidade, mais do que a segurança da PKI, era a principal barreira ao HTTPS, e que certificados gratuitos e automação dependem um do outro.
- Entre os problemas encontrados no caminho está uma falha relatada no início de 2018 no desafio de validação TLS-SNI, que não autenticava o controle do domínio em muitos ambientes de hospedagem compartilhada. O Let's Encrypt desativou esse desafio imediatamente, reativou-o apenas para um pequeno conjunto de provedores não vulneráveis e acabou eliminando-o em favor de um desafio TLS-ALPN. Em separado, o desafio HTTP foi alterado para proibir requisições HTTPS, por causa de uma fraqueza parecida em hospedagem compartilhada. A validação com múltiplas perspectivas, checando a partir de várias redes, foi adicionada contra alguns ataques de rede.
- Nos 90 dias anteriores a 22 de setembro de 2019, a CA concluiu 266 milhões de desafios com sucesso: 86% usaram HTTP, 13% DNS e 0,3% TLS-ALPN.

## Análise crítica

É um relato raro e detalhado de como um serviço de segurança muito usado foi construído, e é aberto sobre os erros. Como evidência, tem limites.

- **Os autores construíram o sistema.** O artigo é ao mesmo tempo um relato de projeto e uma avaliação desse projeto, escrito por seus criadores, então as afirmações sobre sucesso e sobre causas (que gratuidade e automação explicam o crescimento) são interpretação, não comparação controlada. Outros fatores, como os avisos dos navegadores sobre HTTP, também empurraram a adoção.
- **Os dados de adoção são indiretos.** Dependem de varreduras, de logs de CT e da telemetria do canal Beta de um navegador, cada um com seus vieses.
- **A validação de domínio é frágil por natureza.** O artigo diz que a validação em si não é protegida criptograficamente, então "nenhuma dessas medidas protege contra todo o espectro de ataques à validação", e não oferece solução fácil.
- **Mais HTTPS não significa sites mais seguros.** Os autores notam que o Let's Encrypt é usado em sites de phishing e de malware e argumentam que as CAs estão mal posicionadas para detectá-los. Em nossa leitura, essa é uma tensão real: criptografia e identidade do domínio não são o mesmo que confiança no dono do site.
- **O artigo é um retrato de 2019** de um serviço que continuou mudando.

## Pesquisas futuras

- Validação de domínio mais forte, por exemplo com checagens a partir de mais pontos de observação ou formas de vincular um domínio a uma chave sem depender de canais desprotegidos.
- Estudar quanto do crescimento do HTTPS se deve à automação, ao preço ou à política dos navegadores, com desenhos que consigam separar as causas.
- Aplicar a mesma automação a outras partes da PKI da Web e a outras infraestruturas de segurança da Internet, como os autores esperam.
- Medir o efeito sobre o phishing e o que, se algo, as CAs podem razoavelmente fazer a respeito.
