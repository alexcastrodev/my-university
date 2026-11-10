---
title: "Por que o Johnny não consegue criptografar: uma avaliação de usabilidade do PGP 5.0"
summary: Um estudo de usabilidade do programa de criptografia de e-mail PGP 5.0, com uma análise por especialistas e um teste de laboratório com doze pessoas, argumenta que a segurança usável precisa de seu próprio padrão de usabilidade, porque só um terço dos participantes conseguiu enviar um e-mail criptografado.
researchArea: Interação humano-computador
keywords: segurança usável, avaliação de usabilidade, percurso cognitivo, estudo com usuários, pgp, criptografia de chave pública
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

A segurança muitas vezes falha por causa das pessoas, não da criptografia. Os autores citam a afirmação de que erros de configuração podem causar mais de 90% das falhas de segurança em computadores. Ainda assim, os programas de segurança costumam ter interfaces desajeitadas ou inexistentes. Alma Whitten e J. D. Tygar perguntam se isso é apenas falta de um bom projeto de interface comum, ou se a segurança precisa de algo diferente.

A hipótese deles é que as técnicas usuais de projeto para software de consumo não bastam para a segurança. Para testá-la, escolhem um programa que tem uma boa interface pelos padrões gerais, o PGP 5.0, uma ferramenta de criptografia e assinatura de e-mail com interface gráfica, e estudam se novatos conseguem usá-la para proteger seus e-mails. O artigo foi publicado no 8th USENIX Security Symposium, em 1999.

Vale conhecer antes: o que são chaves públicas e privadas, o que significa assinar e criptografar uma mensagem e o que um estudo de usabilidade mede.

## Contribuição

- **Uma definição de usabilidade para segurança.** Um software de segurança é usável se as pessoas que o usam são avisadas de forma confiável sobre as tarefas de segurança que precisam fazer, conseguem descobrir como fazê-las, não cometem erros perigosos e se sentem confortáveis o bastante com a interface para continuar a usá-la.
- **Cinco propriedades da segurança que dificultam o projeto de interfaces:** o usuário desmotivado (a segurança é um objetivo secundário), a abstração (políticas são estranhas para muita gente), a falta de feedback (a configuração certa é a que o usuário realmente quer, algo que o software não pode saber), a porteira aberta (um segredo que foi exposto uma vez não pode ser recolhido) e o elo mais fraco (um único erro basta).
- **Uma avaliação do PGP 5.0** com dois métodos que se complementam: um percurso cognitivo, que é uma análise direta por especialistas, e um teste de usuário em laboratório.
- **Evidência de que uma interface padrão bem projetada não foi suficiente.**

## Metodologia

O percurso cognitivo aplicou o padrão de usabilidade à interface passo a passo e encontrou falhas de projeto que podem contribuir para falhas de segurança. Cobre as metáforas do programa, sua terminologia e ações que não podem ser desfeitas.

No teste com usuários, doze pessoas com experiência em e-mail e que não sabiam explicar a diferença entre criptografia de chave pública e privada assumiram o papel de coordenador de uma campanha política. A tarefa era enviar uma mensagem secreta (o itinerário de um candidato) a cinco membros da equipe, assinada e criptografada com o PGP, usando o programa de e-mail Eudora. Tinham 90 minutos e os manuais. O monitor do teste, fingindo ser membros da equipe, enviava e-mails que dependiam do que o participante fazia: pedir que tentassem criptografar depois de um e-mail em texto simples, dizer que uma mensagem não pôde ser decifrada e lembrá-los de fazer cópia de segurança das chaves.

## Resultados

Estes são os resultados relatados pelos autores.

- Só um terço dos doze participantes (quatro) conseguiu assinar e criptografar corretamente um e-mail para a equipe em 90 minutos.
- Três dos doze (um quarto) enviaram o segredo por e-mail sem criptografia por engano. Dois perceberam na hora, e um pareceu acreditar que a segurança deveria ser transparente para ele e já tinha acontecido.
- Um participante não conseguiu descobrir como criptografar de jeito nenhum. Entre os onze que conseguiram, sete usaram apenas a própria chave pública para criptografar, o que mostra que o modelo de chave pública foi amplamente mal compreendido. Só dois desses sete acabaram enviando um e-mail corretamente criptografado, após avisos bastante explícitos.
- Dez dos doze publicaram a chave pública, e oito obtiveram as chaves dos membros da equipe, todos pelo servidor de chaves. Desses oito, só três expressaram preocupação sobre confiar nas chaves, e nenhum usou os rótulos de validade e confiança da interface.
- Os participantes se confundiram com os ícones de chaves, e alguns temiam publicar a chave privada por engano. Vários expressaram frustração, a ponto de, na avaliação dos autores, provavelmente não continuarem a usar o PGP.
- Os autores concluem que o PGP 5.0 não é usável o bastante para dar segurança efetiva à maioria dos usuários, apesar de sua interface gráfica atraente, e que o projeto de interfaces para segurança efetiva continua sendo um problema em aberto.

## Análise crítica

O artigo é um marco porque nomeia um problema e o mostra com um estudo concreto. Como evidência tem limites, e os autores reconhecem vários.

- **Amostra pequena e escolarizada.** Doze participantes, todos com alguma formação universitária, em um laboratório. Os autores dizem que o objetivo é achar problemas extremos de usabilidade, e não comparar grupos nem estimar taxas, então as proporções (um terço, um quarto) devem ser lidas como ilustrações.
- **O teste não foi totalmente padronizado.** O monitor interpretou os membros da equipe e respondeu de formas diferentes a pessoas diferentes, e os autores discutem isso abertamente. Argumentam que a ajuda extra poderia esconder problemas, mas não inventá-los.
- **Um programa, uma versão, um cenário.** O PGP 5.0 no Macintosh, em uma tarefa de e-mail seguro. Os autores notam que o PGP 6.0 acabara de ser lançado. Se as mesmas propriedades valem para outras ferramentas de segurança é a hipótese do artigo, mais argumentada do que testada.
- **Nenhum projeto alternativo foi experimentado.** A afirmação de que a segurança precisa de um padrão de usabilidade diferente se apoia na falha de um projeto convencional, e não na comparação com um projeto construído sobre o novo padrão. Em nossa leitura, o crescimento posterior da segurança usável como área é o que fortaleceu a afirmação, e isso está fora do artigo.

## Pesquisas futuras

- Princípios e técnicas de projeto de interface feitos para a segurança, que os autores dizem continuar a desenvolver.
- Métodos de avaliação da usabilidade de segurança, já que os autores chamam a boa avaliação para segurança de um problema em aberto por si só.
- Projetos que ajudem os usuários a formar um modelo mental correto das chaves públicas e deem feedback sobre o estado da sua segurança.
- Estudos maiores e mais variados, incluindo outras ferramentas e populações.
