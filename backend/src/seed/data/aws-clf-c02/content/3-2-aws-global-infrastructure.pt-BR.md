---
version: 1.1
updatedAt: 2026-11-21
---
# Infraestrutura global da AWS: Regiões, Zonas de Disponibilidade, pontos de presença e Outposts

> Domínio do exame: **Tecnologia e Serviços de Nuvem (34%)**, objetivo 3.2 *Definir a infraestrutura global da AWS*.

---

## O que o exame quer

Você precisa saber como se relacionam **Regiões, Zonas de Disponibilidade (AZs) e pontos de presença**, por que **várias AZs** dão alta disponibilidade, que **as AZs não compartilham pontos únicos de falha** e **quando usar várias Regiões**: recuperação de desastres, continuidade de negócios, baixa latência para usuários distantes e soberania de dados.

---

## Os três blocos de construção

| Bloco | O que é | Uso principal |
|-------|---------|---------------|
| **Região** | Uma área geográfica formada por várias AZs independentes e fisicamente separadas. A infraestrutura e os serviços de uma Região são isolados dos de outras Regiões | Onde seus recursos e dados ficam |
| **Zona de Disponibilidade** | Um ou mais data centers distintos, com energia, rede e conectividade independentes e redundantes | Isolamento de falhas dentro de uma Região |
| **Ponto de presença (POP, edge location)** | Um site do CloudFront que serve conteúdo popular perto dos espectadores | Menor latência para os usuários finais |

```text
                         Region (us-west-2)
   +------------------------------------------------------------+
   |   AZ 1                 AZ 2                 AZ 3 (or more)  |
   |  [data center(s)]     [data center(s)]     [data center(s)]  |
   |        <==== high-bandwidth, low-latency metro fiber ====>   |
   +------------------------------------------------------------+
                ^ origin
                |
   regional edge cache  (content not popular enough for a POP)
                ^
                |
   edge locations / POPs near viewers  <---  users
```

---

## Regiões

- **Escolha de uma Região**: os serviços e recursos que ela oferece, a latência até a maioria dos seus usuários e os requisitos legais sobre onde os dados podem ser armazenados. Nem todos os serviços estão disponíveis em todas as Regiões, então confira antes de projetar.
- Os dados permanecem na Região que você escolhe, a menos que você mesmo os copie ou replique.
- As Regiões lançadas depois de 20 de março de 2019 são **opt-in**: a conta precisa habilitá-las antes do uso. As Regiões mais antigas vêm habilitadas por padrão.
- O AWS GovCloud (US) e as Regiões da China exigem tipos de conta separados e não podem ser acessados a partir de uma conta padrão da AWS.
- Um código de Região se parece com `eu-west-1`; um endpoint regional se parece com `https://dynamodb.us-west-2.amazonaws.com`.

> Em 21/11/2026, a página de infraestrutura global da AWS mostra atualmente 39 Regiões geográficas e 124 AZs, com mais anunciadas. Os livros trazem números mais antigos e menores. As contagens mudam todo ano: não as memorize.

---

## Zonas de Disponibilidade

- **Cada Região tem pelo menos três AZs.**
- As AZs ficam separadas por muitos quilômetros entre si, mas todas as AZs de uma Região estão a até 100 km (60 milhas) umas das outras, interligadas por fibra metropolitana dedicada e redundante.
- As AZs não compartilham energia, rede nem conectividade, então uma falha em uma AZ (uma inundação, uma queda de energia) não derruba as outras.
- Os IDs de AZ (por exemplo `euw1-az1`) identificam a mesma AZ física em todas as contas; nomes de AZ como `us-east-1a` podem corresponder a AZs físicas diferentes em contas diferentes (contas criadas antes de novembro de 2025, nas Regiões mais antigas).

> Material de estudo antigo diz "pelo menos duas AZs por Região". A documentação oficial atual diz que cada Região tem pelo menos três.

---

## Várias AZs versus várias Regiões

| Requisito | Design |
|-----------|--------|
| Sobreviver à perda de um data center ou de uma AZ | Executar em **várias AZs em uma Região** (por exemplo, atrás de um balanceador de carga) |
| Ter alta disponibilidade e tolerância a falhas com o menor custo adicional | **Várias AZs** em uma Região |
| Se recuperar da perda de uma Região inteira (recuperação de desastres, continuidade de negócios) | **Várias Regiões** |
| Baixa latência para usuários em outro continente | Uma **segunda Região** perto deles, ou **pontos de presença** para conteúdo que pode ser armazenado em cache |
| Os dados precisam permanecer em um determinado país (soberania de dados) | Uma **Região nesse país**, sem replicação para fora dele |

Usar várias AZs permite que aplicações de produção tenham mais alta disponibilidade, tolerância a falhas e escalabilidade do que um único data center permite. Nada no material oficial diz que a tolerância a falhas exige várias Regiões.

---

## Pontos de presença e caches de borda regionais

- Os POPs do CloudFront (pontos de presença) armazenam em cache o conteúdo popular perto dos espectadores. O DNS direciona a requisição ao POP que pode atendê-la melhor, normalmente o mais próximo em latência.
- Os **caches de borda regionais** ficam entre os POPs e a sua origem e guardam conteúdo que não é popular o bastante para permanecer em um POP, ainda assim mais perto dos espectadores do que a origem.
- Os serviços que executam seu plano de dados nos POPs incluem Amazon CloudFront, Amazon Route 53, AWS WAF para CloudFront, AWS Global Accelerator e AWS Shield Advanced.
- Os pontos de presença **não** executam suas instâncias EC2 nem seus bancos de dados e não guardam a cópia principal dos seus dados.

> Em 21/11/2026, o CloudFront lista atualmente mais de 750 POPs e 15 caches de borda regionais. Trate esses números como "centenas de POPs, alguns caches regionais".

---

## AWS Outposts: a AWS nas suas instalações

- Um serviço totalmente gerenciado que estende a infraestrutura, os serviços, as APIs e as ferramentas da AWS ao seu próprio data center ou site, com as mesmas interfaces de programação de uma Região.
- Formatos: **racks Outposts** (42U) e **servidores Outposts** (1U ou 2U). A AWS é dona do hardware, o gerencia e opera a capacidade como parte de uma Região.
- Os recursos aceitos incluem instâncias EC2, volumes EBS, clusters ECS, nós EKS, instâncias de banco de dados RDS (nos racks) e S3 on Outposts.
- Pista: "processar dados no local por requisitos de latência ou de residência de dados, mas usando as mesmas APIs da AWS".

**Não citado no guia do exame (apenas contexto):** as AWS Local Zones colocam computação, armazenamento e alguns serviços selecionados perto de grandes centros populacionais e industriais, para casos de uso de baixa latência, como jogos ou transmissão ao vivo; elas estendem uma Região e não são nem uma Região nem uma AZ. O AWS Wavelength (computação na borda de redes 5G de operadoras de telecomunicações) está explicitamente fora do escopo.

---

## Recursos globais, regionais e zonais

| Escopo | Exemplos |
|--------|----------|
| **Global** (não vinculado a uma Região) | IAM, AWS Organizations, Route 53, CloudFront, Global Accelerator |
| **Regional** | Buckets do S3 (criados em uma Região, que não pode ser alterada), AMIs |
| **Zonal** | Volumes EBS (replicados dentro de uma AZ), instâncias EC2 (cada uma executa em uma AZ) |

Um usuário do IAM funciona em todas as Regiões. Uma AMI pertence a uma Região, então você a copia para usá-la em outra. O console do S3 parece "global", mas cada bucket fica na única Região que você escolheu.

---

## Atenção

- **Mínimo de três AZs.** Respostas que dizem "pelo menos duas" usam a regra antiga.
- **Falha de AZ: várias AZs. Falha de Região: várias Regiões.** Não pague por várias Regiões quando o requisito é apenas "sobreviver a um data center".
- **Pontos de presença armazenam em cache, não hospedam workloads.** O cache nunca substitui um backup nem uma segunda Região.
- **Soberania de dados é uma escolha de Região.** A AWS não move seus dados para outra Região por conta própria.
- **Serviço ausente?** A disponibilidade dos serviços varia por Região; escolha uma Região que o ofereça.
- **Outposts fica no local; uma Local Zone fica perto de uma cidade.** Somente o Outposts está na lista de serviços do exame.
- **Serviços globais**: IAM, Route 53 e CloudFront são globais; EC2 e RDS não são.

## Verificação rápida

1. Qual é o número mínimo de AZs em uma Região? **Três.**
2. Uma aplicação precisa sobreviver a uma inundação em um data center com o menor custo adicional. Qual design? **Várias AZs em uma Região.**
3. Os reguladores exigem que os dados dos clientes permaneçam na Alemanha. O que decide a conformidade em primeiro lugar? **Escolher uma Região na Alemanha e não replicar para fora dela.**
4. Qual infraestrutura serve imagens em cache perto dos espectadores? **Pontos de presença (POPs) do CloudFront.**
5. Uma fábrica precisa executar workloads EC2 no próprio chão de fábrica com as APIs da AWS. Qual serviço? **AWS Outposts.**

## Documentação oficial

- [AWS Regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html)
- [AWS Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html)
- [Availability Zones and fault isolation](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/availability-zones.html)
- [Global services](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/global-services.html)
- [How CloudFront works with regional edge caches](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HowCloudFrontWorks.html)
- [What is AWS Outposts](https://docs.aws.amazon.com/outposts/latest/userguide/what-is-outposts.html)
- [AWS Regions and Availability Zones (global infrastructure)](https://aws.amazon.com/about-aws/global-infrastructure/regions_az/)
